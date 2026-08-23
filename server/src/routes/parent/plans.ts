// What each guardian action actually sends.
//
// One definition per action, used by both the route that signs it and the
// quote that prices it. They used to be written twice — the code apologised
// for it in a comment reading "mirror the real batch exactly" — and had
// already drifted: the grant route honoured `expiryDays` while its quote
// hardcoded no expiry, so an expiring allowance was priced as a permanent one.
//
// Keeping them together makes "the quote is for the transaction you sign"
// structural rather than a promise.
import {
  AAVE, buildAllowlistBatch, buildGrantBatch, buildRevokeBatch, erc20, MANAGER,
  managerIface, parseUnits, predictScopeId, type Tx,
} from '../../chain.js'
import { billerAddress, MONTH_SECONDS, type Service } from '../../subscriptions.js'
import type { Family, Member, Subscription } from '../../store.js'

/** A week, in seconds. The default period a limit runs over. */
const WEEK_DAYS = 7

/**
 * Sum of the period caps of every active scope — the bounded allowance the
 * manager is trusted with. Never `type(uint256).max`.
 *
 * Subscriptions count here exactly as people do. They are scopes on the same
 * contract drawing on the same position, so leaving them out would size the
 * approval below what the billers are entitled to pull, and a collection would
 * revert on the allowance rather than on any rule the household set.
 *
 * `replacing` drops one scope by id, member or subscription, for the case where
 * an old one is revoked in the same operation that grants its replacement:
 * counting both inflates the approval by a cap that is about to stop existing.
 */
export function outstandingCaps(family: Family, extra = 0n, replacing?: string): bigint {
  let total = extra
  for (const m of family.members) {
    if (m.id === replacing) continue
    if (m.scopeId && !m.revoked && m.caps) total += parseUnits(m.caps.period)
  }
  for (const s of family.subscriptions) {
    if (s.id === replacing) continue
    if (s.scopeId && !s.revoked) total += parseUnits(s.price)
  }
  return total
}

export type Limits = {
  perTx: string
  period: string
  periodLengthDays?: number
  expiryDays?: number
}

/**
 * Give someone a spending limit.
 *
 * Three things in one operation, and the order matters.
 *
 * `grant` always mints a new scope id, so changing limits has to retire the
 * old one — otherwise lowering a limit lowers nothing, because the old caps
 * still stand. Worse, the orphaned scope keeps an empty allowlist, which the
 * contract reads as "any recipient": the person you just restricted would
 * hold a permission to pay anyone.
 *
 * Then the grant itself, with the manager's aUSDT approval re-bounded to the
 * new total.
 *
 * Then their allowlist, if they have one. A fresh scope starts empty, so
 * without this the new scope would be briefly wider than the interface says.
 * The id is knowable in advance — the contract derives it from a nonce — which
 * is what lets this be one atomic operation instead of two.
 */
export async function grantPlan(
  family: Family,
  funder: string,
  member: Member,
  limits: Limits,
): Promise<Tx[]> {
  const periodCap = parseUnits(String(limits.period))
  const txs: Tx[] = []

  if (member.scopeId && !member.revoked) {
    txs.push({ to: MANAGER, value: 0n, data: managerIface.encodeFunctionData('revoke', [member.scopeId]) })
  }

  txs.push(...buildGrantBatch({
    spender: member.address,
    perTxCap: parseUnits(String(limits.perTx)),
    periodCap,
    periodLength: BigInt(Math.round(Number(limits.periodLengthDays ?? WEEK_DAYS) * 86400)),
    expiry: limits.expiryDays
      ? BigInt(Math.floor(Date.now() / 1000) + limits.expiryDays * 86400)
      : 0n,
    newAllowanceTotal: outstandingCaps(family, periodCap, member.id),
  }))

  if (member.allowOnly && member.allowed?.length) {
    const scopeId = await predictScopeId(funder, member.address)
    txs.push(...buildAllowlistBatch([scopeId], { allow: member.allowed }))
  }

  return txs
}

export function revokePlan(family: Family, member: Member): Tx[] {
  if (!member.scopeId) throw new Error('member has no allowance')
  return buildRevokeBatch(member.scopeId, outstandingCaps(family, 0n, member.id))
}

/**
 * Sign up to a service.
 *
 * The mandate is a scope like any other, with three differences that are the
 * whole security story:
 *
 * `perTxCap` and `periodCap` are both one month's price, so the biller can take
 * the price once per period and a second attempt is refused on-chain. The
 * allowlist pins the destination to the service's payout address, so the biller
 * cannot redirect the money to itself. And the household can revoke it without
 * asking anyone, which is the part no card mandate gives you.
 */
export async function subscribePlan(
  family: Family,
  funder: string,
  service: Service,
): Promise<Tx[]> {
  const price = parseUnits(service.price)
  const scopeId = await predictScopeId(funder, billerAddress())
  return [
    ...buildGrantBatch({
      spender: billerAddress(),
      perTxCap: price,
      periodCap: price,
      periodLength: BigInt(MONTH_SECONDS),
      expiry: 0n,
      newAllowanceTotal: outstandingCaps(family, price),
    }),
    ...buildAllowlistBatch([scopeId], { allow: [service.payTo] }),
  ]
}

/** Cancel one, and hand back the allowance it was holding. */
export function cancelSubscriptionPlan(family: Family, sub: Subscription): Tx[] {
  if (!sub.scopeId) throw new Error('that subscription was never granted')
  return buildRevokeBatch(sub.scopeId, outstandingCaps(family, 0n, sub.id))
}

type AllowlistChange = {
  /** The list as it will be, canonicalised against the household's book. */
  next: string[]
  /** Addresses to permit, and addresses to withdraw. */
  add: string[]
  drop: string[]
  txs: Tx[]
}

/**
 * Change where one person may pay.
 *
 * Only the difference is written. `setAllowlist` writes the value it is
 * handed and nothing else, so re-sending the whole list would never
 * *un*-permit anything — a removal has to be denied explicitly, or the
 * address stays payable while the interface says otherwise.
 *
 * Turning the restriction off denies everything, because an empty allowlist
 * is already how the contract spells "anyone".
 */
export function allowlistPlan(
  family: Family,
  member: Member,
  only: boolean,
  allowed: string[],
): AllowlistChange {
  // Canonicalise against the book, so an address that is not in it cannot be
  // permitted by hand-crafting a request.
  const known = new Map(family.recipients.map((r) => [r.address.toLowerCase(), r.address]))
  const next = only
    ? [...new Set(allowed.map((a) => known.get(a.toLowerCase())).filter(Boolean) as string[])]
    : []
  const before = member.allowOnly ? (member.allowed ?? []) : []

  const has = new Set(next.map((a) => a.toLowerCase()))
  const had = new Set(before.map((a) => a.toLowerCase()))
  const add = next.filter((a) => !had.has(a.toLowerCase()))
  const drop = before.filter((a) => !has.has(a.toLowerCase()))

  return {
    next,
    add,
    drop,
    txs: member.scopeId && !member.revoked
      ? buildAllowlistBatch([member.scopeId], { allow: add, deny: drop })
      : [],
  }
}

/**
 * Approving an ask needs head-room beyond the standing allowance.
 *
 * Raise it by exactly the request, settle, and put it back — one atomic
 * operation, so the allowance is never unbounded and never left inflated.
 */
export function settlePlan(family: Family, requestId: string, amount: bigint, approve: boolean): Tx[] {
  if (!approve) {
    return [{ to: MANAGER, value: 0n, data: managerIface.encodeFunctionData('denyRequest', [requestId]) }]
  }
  return [
    { to: AAVE.A_ASSET, value: 0n, data: erc20.encodeFunctionData('approve', [MANAGER, outstandingCaps(family, amount)]) },
    { to: MANAGER, value: 0n, data: managerIface.encodeFunctionData('approveRequest', [requestId]) },
    { to: AAVE.A_ASSET, value: 0n, data: erc20.encodeFunctionData('approve', [MANAGER, outstandingCaps(family)]) },
  ]
}