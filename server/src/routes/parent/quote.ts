// What an operation will cost, before it is signed.
//
// Quoting is a read: it needs no key, because WDK builds and prices the
// operation without signing it. Every action is priced from the same `plans`
// the write routes send, so a quote is never about a different transaction.
import { Hono } from 'hono'
import { AAVE, canPayFeesInUsdt, formatUnits, parseUnits, planDeposit, planGuardianPay } from '../../chain.js'
import { bodyOf } from '../../authorize.js'
import { parentOf, refuseParent } from '../guard.js'
import type { Family } from '../../store.js'
import { serviceById } from '../../subscriptions.js'
import {
  allowlistPlan, cancelSubscriptionPlan, grantPlan, revokePlan, settlePlan,
  subscribePlan, type Limits,
} from './plans.js'

export const quoteRoutes = new Hono()

quoteRoutes.post('/api/quote', async (c) => {
  const ctx = await parentOf(c)
  if (!ctx) return refuseParent(c)
  const { session, family } = ctx

  if (!(await canPayFeesInUsdt(session.address))) {
    return c.json({ feeMode: 'sponsored', fee: '0', symbol: AAVE.SYMBOL })
  }

  const body = await bodyOf<Record<string, unknown>>(c)
  let txs
  try {
    txs = await batchFor(family, session.address, body)
  } catch (e) {
    // A blocked action is not a broken quote — say what is actually wrong.
    return c.json({
      feeMode: 'usdt', fee: null, symbol: AAVE.SYMBOL,
      blocked: e instanceof Error ? e.message : 'cannot quote that',
    })
  }
  if (!txs?.length) return c.json({ feeMode: 'sponsored', fee: '0', symbol: AAVE.SYMBOL })

  try {
    const { quoteUnsigned } = await import('../../wdk.js')
    return c.json({
      feeMode: 'usdt',
      fee: formatUnits(await quoteUnsigned(session.address, txs)),
      symbol: AAVE.SYMBOL,
    })
  } catch {
    return c.json({ feeMode: 'usdt', fee: null, symbol: AAVE.SYMBOL })
  }
})

/** The same batch the matching write would send. */
async function batchFor(family: Family, address: string, body: Record<string, unknown>) {
  const member = () => family.members.find((m) => m.id === body.memberId)

  switch (body.action) {
    case 'deposit': {
      const plan = await planDeposit(address, parseUnits(String(body.amount ?? '0')))
      if (!plan.ok) throw new Error(plan.reason)
      return plan.txs
    }
    case 'pay': {
      const plan = await planGuardianPay(address, String(body.to ?? ''), parseUnits(String(body.amount ?? '0')))
      if (!plan.ok) throw new Error(plan.reason)
      return plan.txs
    }
    case 'grant': {
      const m = member()
      if (!m) throw new Error('unknown member')
      return grantPlan(family, address, m, body as unknown as Limits)
    }
    case 'revoke': {
      const m = member()
      if (!m) throw new Error('unknown member')
      return revokePlan(family, m)
    }
    case 'allowlist': {
      const m = member()
      if (!m) throw new Error('unknown member')
      // The same refusal the write gives. Returning "nothing to price" here
      // would have the confirmation sheet say the operation is free, and the
      // write then reject it.
      if (!m.scopeId || m.revoked) {
        throw new Error('Give them a limit first, then choose where it can go.')
      }
      return allowlistPlan(family, m, Boolean(body.only), (body.allowed as string[]) ?? []).txs
    }
    case 'subscribe': {
      const service = serviceById(String(body.serviceId ?? ''))
      if (!service) throw new Error('unknown service')
      if (family.subscriptions.some((s) => s.serviceId === service.id && !s.revoked)) {
        throw new Error(`${service.name} is already running.`)
      }
      return subscribePlan(family, address, service)
    }
    case 'unsubscribe': {
      const sub = family.subscriptions.find((s) => s.id === body.subscriptionId && !s.revoked)
      if (!sub) throw new Error('That subscription is not running.')
      return cancelSubscriptionPlan(family, sub)
    }
    case 'settle': {
      const req = family.requests.find((r) => r.requestId === body.requestId)
      if (!req || req.status !== 'pending') throw new Error('That ask is no longer waiting.')
      return settlePlan(family, req.requestId, parseUnits(req.amount), body.verdict !== 'deny')
    }
    default:
      return null
  }
}
