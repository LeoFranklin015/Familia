// What an operation costs, and whether an account can cover it in USD₮.
//
// A real ERC-20 paymaster integration has to answer "how much of my token can
// this thing take?", and the honest answer depends on what gas costs right
// now. Everything here is priced from live gas rather than a constant.
import { AAVE, formatUnits, provider, USDT_PAYMASTER } from './config.js'
import { assetRead, erc20, paymasterIface, paymasterRead, type Tx } from './abis.js'

/**
 * How much USD₮ the account keeps outside Aave to pay its own fees with, and
 * how large an allowance the paymaster gets — both sized from live gas prices
 * rather than a magic number.
 *
 * A real ERC-20 paymaster integration has to answer "how much of my token can
 * this thing take?", and the honest answer depends on what gas costs right
 * now. We price a representative operation at the current fee, convert it
 * through the paymaster's own rate, and keep a few hundred operations of
 * head-room. When gas gets expensive the buffer grows; when it's cheap it
 * shrinks.
 */
const TYPICAL_OP_GAS = 700_000n // a batched grant/deposit, generously rounded
const OPS_OF_HEADROOM = 250n
const MIN_FEE_BUFFER = 1_000000n // 1 USD₮ — never approve a dust allowance

/**
 * USD₮ cost of one representative operation at current gas prices.
 *
 * Memoised for a few seconds. It is two sequential RPC waves — a fee-data read,
 * then a `quote` against the paymaster — and one "Add money" tap used to run it
 * eight times: once through the quote endpoint and again through the deposit,
 * each reaching it from three directions. Gas does not move meaningfully
 * inside one request, so neither should the answer.
 */
const FEE_TTL_MS = 5_000
let feeMemo: { at: number; value: Promise<bigint> } | null = null

export function feePerOperation(): Promise<bigint> {
  if (!paymasterRead) return Promise.resolve(0n)
  if (!feeMemo || Date.now() - feeMemo.at > FEE_TTL_MS) {
    feeMemo = { at: Date.now(), value: readFeePerOperation() }
    // A failed lookup must not be cached, or one bad RPC poisons five seconds.
    feeMemo.value.catch(() => { feeMemo = null })
  }
  return feeMemo.value
}

async function readFeePerOperation(): Promise<bigint> {
  const fees = await provider.getFeeData()
  const gasPrice = fees.maxFeePerGas ?? fees.gasPrice ?? 1_000_000_000n
  return (await paymasterRead!.quote(TYPICAL_OP_GAS * gasPrice)) as bigint
}

/** The allowance we want the paymaster to hold, at current prices. */
export async function feeAllowanceTarget(): Promise<bigint> {
  const target = (await feePerOperation()) * OPS_OF_HEADROOM
  return target > MIN_FEE_BUFFER ? target : MIN_FEE_BUFFER
}

/** If the standing allowance has been drawn down, top it back up. Returns the
 *  calls to prepend — empty when there's nothing to do, so callers can always
 *  splice it in. */
export async function maybeTopUpFeeAllowance(parent: string): Promise<Tx[]> {
  if (!USDT_PAYMASTER) return []
  const [allowance, perOp] = await Promise.all([
    assetRead.allowance(parent, USDT_PAYMASTER) as Promise<bigint>,
    feePerOperation(),
  ])
  // Re-approve once it's down to a handful of operations' worth.
  if (allowance >= perOp * 20n) return []
  const target = await feeAllowanceTarget()
  return [{ to: AAVE.ASSET, value: 0n, data: erc20.encodeFunctionData('approve', [USDT_PAYMASTER, target]) }]
}

/**
 * How much of the loose balance can actually be supplied.
 *
 * Not all of it. An account that moves every last token into Aave has nothing
 * left to pay the fee for its next operation, and this account pays its own
 * fees in USD₮ — so a few operations' worth stays behind. That reserve is why
 * the interface must offer this figure rather than the raw balance: offering
 * the whole thing and then refusing it is how "Add money" became a button
 * that never worked.
 */
export async function depositableAmount(parent: string): Promise<bigint> {
  const [held, perOp] = await Promise.all([
    assetRead.balanceOf(parent) as Promise<bigint>,
    feePerOperation(),
  ])
  const reserve = perOp * 20n
  return held > reserve ? held - reserve : 0n
}

/** Whether this account can pay its own fees in USD₮ right now: it needs both
 *  a balance and a standing approval to the paymaster. */
export async function canPayFeesInUsdt(address: string): Promise<boolean> {
  if (!USDT_PAYMASTER) return false
  const [balance, allowance, perOp] = await Promise.all([
    assetRead.balanceOf(address) as Promise<bigint>,
    assetRead.allowance(address, USDT_PAYMASTER) as Promise<bigint>,
    feePerOperation(),
  ])
  // Enough for at least one operation at today's prices, with margin.
  const floor = perOp * 2n
  return balance >= floor && allowance >= floor
}

/** Pull the real USD₮ fee out of a userOp receipt, if our paymaster charged one. */
export function feeChargedFromLogs(logs: Array<{ address: string; topics: string[]; data: string }>): string | null {
  if (!USDT_PAYMASTER) return null
  for (const log of logs) {
    if (log.address.toLowerCase() !== USDT_PAYMASTER.toLowerCase()) continue
    try {
      const parsed = paymasterIface.parseLog(log)
      if (parsed?.name === 'Charged') return formatUnits(parsed.args.usdtCharged as bigint)
    } catch { /* not ours */ }
  }
  return null
}
