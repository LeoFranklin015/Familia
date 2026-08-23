// Reading the chain's answers back: storage, receipts, and reverts.
import { ethers } from 'ethers'
import { AAVE, MANAGER } from './config.js'
import { managerIface, poolRead } from './abis.js'

/**
 * The supply rate, as a plain fraction per year.
 *
 * Aave stores it in ray (1e27) as a simple annual rate, and grows a balance by
 * `1 + rate * elapsed / year` — linear, not compounded. Handing the interface
 * the same number lets it project between reads with the contract's own
 * arithmetic instead of inventing a curve.
 */
export async function supplyApr(): Promise<number> {
  try {
    const d = await poolRead.getReserveData(AAVE.ASSET)
    return Number(d.currentLiquidityRate) / 1e27
  } catch {
    return 0 // no rate is better than a made-up one: the figure just sits still
  }
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
