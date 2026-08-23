// Everything the guardian's app renders from.
import { Hono } from 'hono'
import {
  AAVE, aAssetRead, canPayFeesInUsdt, depositableAmount, formatUnits,
  managerRead, spentInCurrentPeriod, supplyApr,
} from '../../chain.js'
import { bootstrapStatus } from '../../bootstrap.js'
import { SERVICES, serviceById } from '../../subscriptions.js'
import { parentOf, refuseParent } from '../guard.js'
import { outstandingCaps } from './plans.js'
import { hasExpired } from './money.js'

export const stateRoutes = new Hono()

stateRoutes.get('/api/state', async (c) => {
  const ctx = await parentOf(c)
  if (!ctx) return refuseParent(c)
  const { session, family } = ctx

  // One wave. The member scope reads do not depend on any wallet value, and
  // running them after it cost a whole round trip on every ten-second poll.
  const [pool, addable, paysInUsdt, apr, members, subscriptions] = await Promise.all([
    aAssetRead.balanceOf(session.address) as Promise<bigint>,
    depositableAmount(session.address),
    canPayFeesInUsdt(session.address),
    supplyApr(),
    Promise.all(family.members.map(readMember)),
    Promise.all(family.subscriptions.map(readSubscription)),
  ])

  return c.json({
    familyName: family.name,
    symbol: AAVE.SYMBOL,
    you: { name: family.parent?.name ?? 'You', address: session.address },
    wallet: {
      address: session.address,
      pot: formatUnits(pool),
      // What "Add money" may offer: the loose balance minus the fee headroom
      // this account needs to keep paying its own way.
      addable: formatUnits(addable),
      // Aave's supply rate, and when the balance above was read. Together
      // these let the interface carry the figure forward between polls using
      // the same linear-interest arithmetic the pool itself uses.
      apr,
      potAt: Date.now(),
      feeMode: paysInUsdt ? 'usdt' : 'sponsored',
      setup: bootstrapStatus(session.address),
    },
    // The sum the manager is actually approved for. Computed here because it
    // is the same number that sizes the on-chain approval; the interface used
    // to re-derive it in floats and could silently disagree.
    promised: formatUnits(outstandingCaps(family)),
    activity: family.activity,
    members,
    // A lapsed ask is not waiting for anyone: the contract would refuse it.
    pendingRequests: family.requests
      .filter((r) => r.status === 'pending' && !hasExpired(r))
      .map((r) => ({
        ...r,
        memberName: family.members.find((m) => m.id === r.memberId)?.name ?? '?',
      })),
    recipients: family.recipients,
    // What the household could sign up to, and what it already has.
    services: SERVICES,
    subscriptions,
  })
})

/**
 * One mandate, joined to its service and read back off the contract.
 *
 * `dueNow` is the contract's answer, not ours: `spendable` is zero for the rest
 * of the period once a month has been taken, and zero forever once the mandate
 * is revoked.
 */
async function readSubscription(s: import('../../store.js').Subscription) {
  const service = serviceById(s.serviceId)
  let dueNow = false
  let renewsAt = 0

  if (s.scopeId && !s.revoked) {
    const [spendable, resets] = await Promise.all([
      managerRead.spendable(s.scopeId) as Promise<bigint>,
      managerRead.periodResetsAt(s.scopeId) as Promise<bigint>,
    ])
    dueNow = spendable > 0n
    renewsAt = Number(resets)
  }

  return {
    id: s.id,
    serviceId: s.serviceId,
    name: service?.name ?? s.serviceId,
    payTo: service?.payTo ?? '',
    price: s.price,
    scopeId: s.scopeId ?? null,
    revoked: Boolean(s.revoked),
    startedAt: s.startedAt,
    charges: s.charges,
    dueNow,
    renewsAt,
  }
}

/** One member's live position, read from the contract. */
async function readMember(m: import('../../store.js').Member) {
  let spendable = '0'
  let spent = '0'
  let resetsAt = 0

  if (m.scopeId && !m.revoked) {
    const [sp, scope, resets] = await Promise.all([
      managerRead.spendable(m.scopeId) as Promise<bigint>,
      managerRead.getScope(m.scopeId),
      managerRead.periodResetsAt(m.scopeId) as Promise<bigint>,
    ])
    spendable = formatUnits(sp)
    spent = formatUnits(spentInCurrentPeriod(scope, resets))
    resetsAt = Number(resets)
  }

  return {
    id: m.id,
    name: m.name,
    address: m.address,
    scopeId: m.scopeId ?? null,
    caps: m.caps ?? null,
    revoked: Boolean(m.revoked),
    spendable,
    spentThisPeriod: spent,
    resetsAt,
    // Where this one may pay. Per person, as the contract stores it.
    allowOnly: Boolean(m.allowOnly),
    allowed: m.allowed ?? [],
  }
}
