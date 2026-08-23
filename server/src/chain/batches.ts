// The calldata each action sends.
//
// Every function here returns calls rather than sending them, so the route
// signs exactly the array `/api/quote` priced. Separating construction from
// sending is what lets a quote be about the transaction that will happen.
import { ethers } from 'ethers'
import { AAVE, MANAGER, USDT_PAYMASTER, formatUnits, provider } from './config.js'
import { aAssetRead, assetRead, erc20, faucetIface, managerIface, poolIface, type Tx } from './abis.js'
import { depositableAmount, feeAllowanceTarget, maybeTopUpFeeAllowance } from './fees.js'

/**
 * How much test USD₮ to pull the one time the faucet lets us.
 *
 * The Aave testnet faucet enforces a per-address mint timelock — one mint per
 * period, regardless of size, and it happily mints very large amounts. So we
 * take a generous amount once and fund every later deposit out of the balance
 * we already hold. Minting per deposit would work exactly once and then fail
 * with "Mint timelock exceeded" for the rest of the day.
 */
const MINT_CHUNK = 100_000_000000n // 100,000 USD₮

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

function buildDepositBatch(parent: string, amount: bigint): Tx[] {
  return [
    { to: AAVE.ASSET, value: 0n, data: erc20.encodeFunctionData('approve', [AAVE.POOL, amount]) },
    { to: AAVE.POOL, value: 0n, data: poolIface.encodeFunctionData('supply', [AAVE.ASSET, amount, parent, 0]) },
  ]
}

/** Would the faucet let this account mint right now? It refuses with
 *  "Mint timelock exceeded" once per period, so ask before building a batch
 *  around it rather than discovering it in a reverted simulation. */
async function faucetWouldMint(parent: string, amount: bigint): Promise<boolean> {
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
 * Plan a deposit out of what the account already holds. No faucet.
 *
 * Funding happens once, during onboarding. Keeping the faucet out of this path
 * is what makes a second deposit possible at all — it allows one mint per
 * address per day — and it means adding money only ever moves what the
 * household already has.
 */
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

/**
 * Give one person a scope, and re-bound the manager's aUSDT approval to the
 * sum of outstanding period caps. Never unlimited.
 */
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
function buildGuardianPayBatch(to: string, amount: bigint): Tx[] {
  return [{ to: AAVE.POOL, value: 0n, data: poolIface.encodeFunctionData('withdraw', [AAVE.ASSET, amount, to]) }]
}
