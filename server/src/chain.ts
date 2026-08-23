// Addresses, interfaces and calldata builders. Token addresses come from the
// canonical Aave address book — never pasted hex.
//
// Base Sepolia. The family money is USD₮ supplied to Aave V3's real pool, so
// the parent holds genuine aUSDT and a member's spend redeems it through Aave
// itself — no vault of ours anywhere in the path.
//
// Why not Ethereum Sepolia: its Aave USDT reserve sits ~2x over its supply cap
// and reverts with error 51 for any amount (so do USDC and DAI). Base
// Sepolia's USDT reserve is uncapped, faucet-mintable and liquid. The trade is
// that Pimlico/Candide only price gas in USD₮ on Ethereum Sepolia, so here
// every operation is fully sponsored instead — which the track allows.
import { ethers } from 'ethers'
import { AaveV3BaseSepolia } from '@bgd-labs/aave-address-book'

// This module reads env at import time, so the env file loads here — ESM
// hoists imports, which makes loading it in index.ts too late.
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url).pathname)
} catch { /* fine in environments that export the vars directly */ }

export const CHAIN_ID = 84532

/** Aave's public testnet faucet on Base Sepolia — the token's owner, and
 *  unpermissioned (`isPermissioned() == false`), so the parent can mint their
 *  own test USD₮ inside their first sponsored operation. */
const FAUCET = '0xD9145b5F45Ad4519c7ACcD6E0A4A82e83bB8A6Dc'

export const AAVE = {
  FAUCET,
  POOL: AaveV3BaseSepolia.POOL as string,
  ASSET: AaveV3BaseSepolia.ASSETS.USDT.UNDERLYING as string,
  // Aave's own aUSDT: what the parent holds, and what the manager pulls and
  // redeems on a spend. Interest-bearing and rebasing, so balances are always
  // read inside the transaction and never cached.
  A_ASSET: AaveV3BaseSepolia.ASSETS.USDT.A_TOKEN as string,
  DECIMALS: 6,
  // Plain ticker: ₮ (U+20AE) is outside the UI font's subset and would
  // render in a fallback face beside every figure.
  SYMBOL: 'USDT',
}

export const MANAGER = requireEnv('SCOPED_SPEND_MANAGER_ADDRESS')
export const DELEGATION_ADDRESS = requireEnv('DELEGATION_ADDRESS')
export const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org'
export const BUNDLER_URL = `https://api.pimlico.io/v2/${CHAIN_ID}/rpc?apikey=${requireEnv('PIMLICO_API_KEY')}`
export const POLICY_ID = process.env.POLICY_ID || undefined

/** Our own USD₮ paymaster, and the ERC-7677 service in front of it. No
 *  provider prices gas in USD₮ on this chain, so we run one. */
export const USDT_PAYMASTER = process.env.USDT_PAYMASTER_ADDRESS || ''
export const PAYMASTER_SERVICE_URL =
  process.env.PAYMASTER_SERVICE_URL || `http://localhost:${process.env.PORT ?? 8787}/paymaster`

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

/** USD₮ cost of one representative operation at current gas prices. */
export async function feePerOperation(): Promise<bigint> {
  if (!USDT_PAYMASTER) return 0n
  const [fees, pm] = [await provider.getFeeData(), new ethers.Contract(USDT_PAYMASTER, [
    'function quote(uint256) view returns (uint256)',
  ], provider)]
  const gasPrice = fees.maxFeePerGas ?? fees.gasPrice ?? 1_000_000_000n
  return (await pm.quote(TYPICAL_OP_GAS * gasPrice)) as bigint
}

/** The allowance we want the paymaster to hold, at current prices. */
export async function feeAllowanceTarget(): Promise<bigint> {
  const perOp = await feePerOperation()
  const target = perOp * OPS_OF_HEADROOM
  return target > MIN_FEE_BUFFER ? target : MIN_FEE_BUFFER
}

/** If the standing allowance has been drawn down, top it back up. Returns the
 *  calls to prepend — empty when there's nothing to do, so callers can always
 *  splice it in. */
export async function maybeTopUpFeeAllowance(parent: string): Promise<Tx[]> {
  if (!USDT_PAYMASTER) return []
  const [allowance, target, perOp] = await Promise.all([
    assetRead.allowance(parent, USDT_PAYMASTER) as Promise<bigint>,
    feeAllowanceTarget(),
    feePerOperation(),
  ])
  // Re-approve once it's down to a handful of operations' worth.
  if (allowance >= perOp * 20n) return []
  return [{ to: AAVE.ASSET, value: 0n, data: erc20.encodeFunctionData('approve', [USDT_PAYMASTER, target]) }]
}

/**
 * How much test USD₮ to pull the one time the faucet lets us.
 *
 * The Aave testnet faucet enforces a per-address mint timelock — one mint per
 * period, regardless of size, and it happily mints very large amounts. So we
 * take a generous amount once and fund every later deposit out of the balance
 * we already hold. Minting per deposit would work exactly once and then fail
 * with "Mint timelock exceeded" for the rest of the day.
 */
export const MINT_CHUNK = 100_000_000000n // 100,000 USD₮

export const provider = new ethers.JsonRpcProvider(RPC_URL)

export const erc20 = new ethers.Interface([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
])
export const faucetIface = new ethers.Interface([
  'function mint(address token, address to, uint256 amount) returns (uint256)',
])
export const poolIface = new ethers.Interface([
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function withdraw(address asset, uint256 amount, address to) returns (uint256)',
])
export const managerIface = new ethers.Interface([
  'function grant(address spender, address asset, address source, uint256 perTxCap, uint256 periodCap, uint256 periodLength, uint256 expiry) returns (bytes32)',
  'function updateScope(bytes32 id, uint256 perTxCap, uint256 periodCap, uint256 periodLength, uint256 expiry)',
  'function setAllowlist(bytes32 id, address[] targets, bool allowed)',
  'function revoke(bytes32 id)',
  'function spend(bytes32 id, address to, uint256 amount)',
  'function requestSpend(bytes32 id, address to, uint256 amount, uint256 ttl) returns (bytes32)',
  'function approveRequest(bytes32 requestId)',
  'function denyRequest(bytes32 requestId)',
  'function spendable(bytes32 id) view returns (uint256)',
  'function periodResetsAt(bytes32 id) view returns (uint64)',
  'function getScope(bytes32 id) view returns (tuple(address funder, address spender, address asset, address source, uint128 perTxCap, uint128 periodCap, uint48 periodLength, uint48 grantedAt, uint48 expiry, bool revoked, uint128 spentInPeriod, uint48 periodStart, uint32 allowlistSize))',
  'event Granted(bytes32 indexed id, address indexed funder, address indexed spender, address asset, address source, uint256 perTxCap, uint256 periodCap, uint256 periodLength, uint256 expiry)',
  'event SpendRequested(bytes32 indexed requestId, bytes32 indexed id, address indexed to, uint256 amount, uint256 expiresAt)',
  'event Spent(bytes32 indexed id, address indexed to, uint256 amount, bytes32 requestId)',
])

/** Our paymaster's settlement event — the authoritative record of what an
 *  account was actually charged, in USD₮, after the operation ran. */
export const paymasterIface = new ethers.Interface([
  'event Charged(address indexed account, uint256 gasCostWei, uint256 usdtCharged)',
])

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

export const managerRead = new ethers.Contract(MANAGER, managerIface, provider)
export const assetRead = new ethers.Contract(AAVE.ASSET, erc20, provider)
export const aAssetRead = new ethers.Contract(AAVE.A_ASSET, erc20, provider)

export type Tx = { to: string; value: bigint; data: string }

/** Mint test USD₮ from the Aave faucet, approve the savings position, and
 *  deposit — one batched, sponsored UserOperation, from an account that starts
 *  with nothing at all (not even gas). */
/**
 * The parent's very first operation, run during onboarding.
 *
 * This is the only place the faucet is touched. It enforces one mint per
 * address per day regardless of size, so we take a generous amount here and
 * fund every later deposit from the balance we already hold — otherwise the
 * second deposit of the day fails with "Mint timelock exceeded".
 *
 * It also sets the paymaster's allowance, which is what lets the account pay
 * its own fees in USD₮ from this point on.
 */
export async function buildOnboardingBatch(parent: string): Promise<Tx[]> {
  const txs: Tx[] = []
  const held = (await assetRead.balanceOf(parent)) as bigint
  if (held < MINT_CHUNK && (await faucetWouldMint(parent, MINT_CHUNK))) {
    txs.push({ to: AAVE.FAUCET, value: 0n, data: faucetIface.encodeFunctionData('mint', [AAVE.ASSET, parent, MINT_CHUNK]) })
  }
  if (USDT_PAYMASTER) {
    txs.push({
      to: AAVE.ASSET, value: 0n,
      data: erc20.encodeFunctionData('approve', [USDT_PAYMASTER, await feeAllowanceTarget()]),
    })
  }
  return txs
}

export function buildDepositBatch(parent: string, amount: bigint): Tx[] {
  return [
    { to: AAVE.ASSET, value: 0n, data: erc20.encodeFunctionData('approve', [AAVE.POOL, amount]) },
    { to: AAVE.POOL, value: 0n, data: poolIface.encodeFunctionData('supply', [AAVE.ASSET, amount, parent, 0]) },
  ]
}

/** Would the faucet let this account mint right now? It refuses with
 *  "Mint timelock exceeded" once per period, so ask before building a batch
 *  around it rather than discovering it in a reverted simulation. */
export async function faucetWouldMint(parent: string, amount: bigint): Promise<boolean> {
  try {
    await provider.call({
      to: AAVE.FAUCET,
      from: parent,
      data: faucetIface.encodeFunctionData('mint', [AAVE.ASSET, parent, amount]),
    })
    return true
  } catch {
    return false
  }
}

/**
 * Plan a deposit purely out of what the account already holds — no faucet.
 *
 * Funding happens once, during onboarding. Keeping the faucet out of the
 * deposit path is what makes a second deposit possible at all, and it means
 * "add to the pot" only ever moves money the household already has.
 */
/**
 * How much of the loose balance can actually be supplied.
 *
 * Not all of it: an account that moves every last token into Aave has nothing
 * left to pay the fee for its next operation with, and this account pays its
 * own fees in USD₮. So a few operations' worth stays behind, and that is the
 * figure the interface should offer — offering the full balance and then
 * refusing it is how "Add money" becomes a button that never works.
 */
export async function depositableAmount(parent: string): Promise<bigint> {
  const [held, perOp] = await Promise.all([
    assetRead.balanceOf(parent) as Promise<bigint>,
    feePerOperation(),
  ])
  const reserve = perOp * 20n
  return held > reserve ? held - reserve : 0n
}

export async function planDeposit(parent: string, amount: bigint): Promise<
  | { ok: true; txs: Tx[] }
  | { ok: false; reason: string }
> {
  const held = (await assetRead.balanceOf(parent)) as bigint
  const available = await depositableAmount(parent)

  if (amount > available) {
    return {
      ok: false,
      reason: available > 0n
        ? `This account holds ${formatUnits(held)} ${AAVE.SYMBOL}. You can add up to ${formatUnits(available)}, keeping a little back for network fees.`
        : `This account has no ${AAVE.SYMBOL} left to add. Its faucet top-up is once per day.`,
    }
  }

  const topUp = await maybeTopUpFeeAllowance(parent)
  return { ok: true, txs: [...topUp, ...buildDepositBatch(parent, amount)] }
}

/**
 * Plan the guardian paying someone out of the household position.
 *
 * Refused up front when the position is too small, so the person sees "there
 * isn't that much" before signing rather than a reverted simulation after.
 */
export async function planGuardianPay(parent: string, to: string, amount: bigint): Promise<
  | { ok: true; txs: Tx[] }
  | { ok: false; reason: string }
> {
  const held = (await aAssetRead.balanceOf(parent)) as bigint
  if (amount > held) {
    return {
      ok: false,
      reason: `The household balance is ${formatUnits(held)} ${AAVE.SYMBOL}. Nothing was spent.`,
    }
  }
  const topUp = await maybeTopUpFeeAllowance(parent)
  return { ok: true, txs: [...topUp, ...buildGuardianPayBatch(to, amount)] }
}

/** Whether this account can currently pay its own fees in USD₮: it needs a
 *  USD₮ balance and a standing approval to the paymaster. */
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

/** Grant a member a scope and (re)bound the manager's aUSDT allowance to the
 *  sum of outstanding period caps — never unlimited. One batched UserOp. */
export function buildGrantBatch(opts: {
  spender: string
  perTxCap: bigint
  periodCap: bigint
  periodLength: bigint
  expiry: bigint
  newAllowanceTotal: bigint
}): Tx[] {
  return [
    { to: AAVE.A_ASSET, value: 0n, data: erc20.encodeFunctionData('approve', [MANAGER, opts.newAllowanceTotal]) },
    {
      to: MANAGER,
      value: 0n,
      data: managerIface.encodeFunctionData('grant', [
        opts.spender, AAVE.ASSET, AAVE.A_ASSET, opts.perTxCap, opts.periodCap, opts.periodLength, opts.expiry,
      ]),
    },
  ]
}

export function buildRevokeBatch(scopeId: string, newAllowanceTotal: bigint): Tx[] {
  return [
    { to: MANAGER, value: 0n, data: managerIface.encodeFunctionData('revoke', [scopeId]) },
    { to: AAVE.A_ASSET, value: 0n, data: erc20.encodeFunctionData('approve', [MANAGER, newAllowanceTotal]) },
  ]
}

/**
 * The id `grant` is about to mint, computed before it runs.
 *
 * The contract derives it as keccak(funder, spender, asset, source, nonce++),
 * so with the nonce in hand the id is knowable in advance — which is what lets
 * a grant and the allowlist that should apply to it go out as one atomic
 * operation instead of two. Without this the new scope would exist, briefly,
 * accepting any recipient while the interface claimed otherwise.
 *
 * `_nonce` has no getter, so it is read from its storage slot. The layout is
 * fixed by declaration order and `pool` is immutable, so: _scopes 0,
 * allowlist 1, _requests 2, _nonce 3.
 *
 * The nonce is shared across every funder on the contract, so a grant by
 * another household between this read and our execution would shift it. That
 * costs correctness nothing — `setAllowlist` checks the caller owns the scope,
 * so a stale guess reverts the whole batch and the grant simply has not
 * happened yet. Loud and atomic beats silently writing the wrong list.
 */
const NONCE_SLOT = 3n

export async function predictScopeId(funder: string, spender: string): Promise<string> {
  const raw = await provider.getStorage(MANAGER, NONCE_SLOT)
  return ethers.solidityPackedKeccak256(
    ['address', 'address', 'address', 'address', 'uint256'],
    [funder, spender, AAVE.ASSET, AAVE.A_ASSET, BigInt(raw)],
  )
}

/**
 * Write the household's recipient book into scopes' allowlists.
 *
 * The contract holds one allowlist per scope and treats an empty one as "any
 * recipient", so turning enforcement off means emptying the list rather than
 * setting a flag.
 *
 * Allowing and denying are separate calls because `setAllowlist` only writes
 * the value it is given. Dropping someone from the book therefore has to deny
 * them explicitly — re-sending the remaining addresses as allowed would leave
 * the removed one still payable, which is the one direction of drift that
 * matters: the chain wider than the interface claims.
 *
 * Every scope needs the same edit, so they go out together. A household of
 * four costs the same fifteen seconds as a household of one.
 */
export function buildAllowlistBatch(
  scopeIds: string[],
  change: { allow?: string[]; deny?: string[] },
): Tx[] {
  const call = (id: string, targets: string[], allowed: boolean): Tx => ({
    to: MANAGER,
    value: 0n,
    data: managerIface.encodeFunctionData('setAllowlist', [id, targets, allowed]),
  })
  return scopeIds.flatMap((id) => [
    ...(change.allow?.length ? [call(id, change.allow, true)] : []),
    ...(change.deny?.length ? [call(id, change.deny, false)] : []),
  ])
}

/**
 * The guardian paying someone directly out of the household position.
 *
 * They are the funder, not a spender, so no scope and no allowlist is
 * involved — Aave burns their aUSDT and sends the underlying straight to the
 * recipient, which is a single call. Nothing here can exceed the position,
 * because Aave itself refuses to withdraw more than is held.
 */
export function buildGuardianPayBatch(to: string, amount: bigint): Tx[] {
  return [{ to: AAVE.POOL, value: 0n, data: poolIface.encodeFunctionData('withdraw', [AAVE.ASSET, amount, to]) }]
}

export function parseUnits(v: string | number): bigint {
  return ethers.parseUnits(String(v), AAVE.DECIMALS)
}
export function formatUnits(v: bigint): string {
  return ethers.formatUnits(v, AAVE.DECIMALS)
}

/**
 * What has been spent in the period that is running *now*.
 *
 * `spentInPeriod` is storage, and the contract only clears it on the next
 * write — so between a week rolling over and the next payment, the stored
 * figure still belongs to the week before. `spendable()` already knows this
 * and ignores it; anything reading the raw value shows a member a week's
 * spending that no longer counts against them, and then refuses amounts the
 * chain would have paid.
 *
 * The comparison uses `periodResetsAt`, which the contract derives from
 * `block.timestamp` — so this follows the chain's clock rather than ours, and
 * the boundary is decided by the same authority that will enforce it.
 */
export function spentInCurrentPeriod(
  scope: { spentInPeriod: bigint; periodStart: bigint | number; periodLength: bigint | number },
  resetsAt: bigint,
): bigint {
  const length = BigInt(scope.periodLength)
  if (length === 0n) return scope.spentInPeriod
  const currentStart = resetsAt - length
  return currentStart === BigInt(scope.periodStart) ? scope.spentInPeriod : 0n
}

/** Pull an event arg out of a userOp receipt's logs. */
export function eventArgFromLogs(logs: Array<{ address: string; topics: string[]; data: string }>, eventName: string, arg: string): string | undefined {
  for (const log of logs) {
    if (log.address.toLowerCase() !== MANAGER.toLowerCase()) continue
    try {
      const parsed = managerIface.parseLog(log)
      if (parsed?.name === eventName) return String(parsed.args[arg])
    } catch { /* not ours */ }
  }
  return undefined
}

/** Map a bundler simulation revert to the manager's named error, in human
 *  words. The revert data hides inside nested error messages as hex. */
const MANAGER_ERRORS: Array<[string, string]> = [
  ['Revoked()', 'The contract refused it: this allowance was revoked on-chain.'],
  ['Expired()', 'The contract refused it: this allowance has expired.'],
  ['OverPerTxCap(uint256,uint256)', 'The contract refused it: over the per-purchase limit.'],
  ['OverPeriodCap(uint256,uint256)', 'The contract refused it: over the limit for this period.'],
  ['RecipientNotAllowed(address)', "The contract refused it: that recipient isn't on the allowed list."],
  ['NotSpender()', 'The contract refused it: this account is not the spender.'],
  ['UnknownId()', 'The contract refused it: unknown allowance.'],
  ['RequestExpired()', 'The contract refused it: this ask expired.'],
  ['TransferFailed()', 'The contract refused it: the funds could not be pulled.'],
]
const SELECTOR_TO_HUMAN = new Map(MANAGER_ERRORS.map(([sig, msg]) => [ethers.id(sig).slice(2, 10), msg]))

export function humanizeManagerRevert(err: unknown): string | null {
  const messages: string[] = []
  for (let e = err as { message?: string; cause?: unknown } | undefined; e; e = e.cause as never) {
    if (typeof e.message === 'string') messages.push(e.message)
  }
  const hex = messages.join(' ').match(/0x[0-9a-fA-F]{8,}/g)?.join('') ?? ''
  for (const [selector, human] of SELECTOR_TO_HUMAN) {
    if (hex.includes(selector)) return human
  }
  return null
}

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var ${name}. Copy .env.example and fill it in.`)
  return v
}
