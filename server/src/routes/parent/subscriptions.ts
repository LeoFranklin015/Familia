// Signing up to a service, cancelling, and letting the biller collect.
//
// Two of these three are guardian writes and go out as sponsored or self-paid
// UserOperations like everything else. The third is not the household's
// transaction at all: the biller sends it, from its own account, paying its own
// gas. That asymmetry is the point of a mandate.
import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { eventArgFromLogs, feeChargedFromLogs, humanizeManagerRevert, parseUnits } from '../../chain.js'
import { record, updateFamily } from '../../store.js'
import { waitForUserOp } from '../../wdk.js'
import { collect, serviceById, TERM_MONTHS, TERM_SECONDS } from '../../subscriptions.js'
import { parentOf, parentWrite, refuseParent } from '../guard.js'
import { cancelSubscriptionPlan, subscribePlan } from './plans.js'

export const subscriptionRoutes = new Hono()

subscriptionRoutes.post('/api/subscriptions/:serviceId/subscribe', (c) =>
  parentWrite(c, async (account, family, address) => {
    const service = serviceById(c.req.param('serviceId'))
    if (!service) return c.json({ error: 'unknown service' }, 404)

    const live = family.subscriptions.find((s) => s.serviceId === service.id && !s.revoked)
    if (live) return c.json({ error: `${service.name} is already running.` }, 409)

    const { hash } = await account.sendTransaction(await subscribePlan(family, address, service))
    const result = await waitForUserOp(account, hash)
    if (!result.success) return c.json({ error: `Subscribing to ${service.name} failed. Try again.` }, 502)

    const scopeId = eventArgFromLogs(result.logs, 'Granted', 'id')
    if (!scopeId) return c.json({ error: 'Granted event missing from receipt' }, 500)

    await updateFamily(family.id, (f) => {
      f.subscriptions.push({
        id: randomUUID(),
        serviceId: service.id,
        scopeId,
        price: service.price,
        startedAt: Date.now(),
        endsAt: Math.floor(Date.now() / 1000) + TERM_SECONDS,
        charges: [],
      })
    })
    await record(family.id, {
      kind: 'allowance',
      text: `${service.name} can take ${service.price} a month for ${TERM_MONTHS} months`,
      txHash: result.txHash,
    })
    return c.json({ scopeId, txHash: result.txHash, feeCharged: feeChargedFromLogs(result.logs) })
  }))

subscriptionRoutes.post('/api/subscriptions/:id/cancel', (c) =>
  parentWrite(c, async (account, family) => {
    const sub = family.subscriptions.find((s) => s.id === c.req.param('id') && !s.revoked)
    if (!sub) return c.json({ error: 'no such subscription' }, 404)
    const name = serviceById(sub.serviceId)?.name ?? 'That service'

    const { hash } = await account.sendTransaction(cancelSubscriptionPlan(family, sub))
    const result = await waitForUserOp(account, hash)
    if (!result.success) return c.json({ error: 'Cancelling failed. Try again.' }, 502)

    await updateFamily(family.id, (f) => {
      const s = f.subscriptions.find((x) => x.id === sub.id)
      if (s) s.revoked = true
    })
    await record(family.id, {
      kind: 'revoke',
      text: `${name} cancelled, it can take nothing more`,
      txHash: result.txHash,
    })
    return c.json({ txHash: result.txHash, feeCharged: feeChargedFromLogs(result.logs) })
  }))

/**
 * The biller collects this month.
 *
 * Not a guardian write. Nothing here is signed by the household, and no vault
 * is opened, because the household already gave its permission when it granted
 * the scope. What stands between the biller and the money is the contract.
 *
 * In the real thing a scheduler runs this. Here the guardian triggers it, so
 * the demo does not have to wait a month, which is why it still needs a parent
 * session even though it needs no parent signature.
 */
subscriptionRoutes.post('/api/subscriptions/:id/charge', async (c) => {
  const ctx = await parentOf(c)
  if (!ctx) return refuseParent(c)
  const { family } = ctx

  const sub = family.subscriptions.find((s) => s.id === c.req.param('id'))
  if (!sub?.scopeId) return c.json({ error: 'no such subscription' }, 404)
  const service = serviceById(sub.serviceId)
  if (!service) return c.json({ error: 'unknown service' }, 404)

  try {
    const { txHash } = await collect(sub.scopeId, service.payTo, parseUnits(sub.price))
    await updateFamily(family.id, (f) => {
      const s = f.subscriptions.find((x) => x.id === sub.id)
      s?.charges.push({ at: Date.now(), amount: sub.price, txHash })
    })
    await record(family.id, {
      kind: 'payment',
      text: `${service.name} took ${sub.price}`,
      amount: sub.price,
      txHash,
    })
    return c.json({ txHash, amount: sub.price })
  } catch (e) {
    // The contract's own refusal, in words. Taking twice in one month lands
    // here, and so does collecting on a cancelled mandate.
    const refusal = humanizeManagerRevert(e)
      ?? (e instanceof Error ? e.message : 'The collection did not go through.')
    return c.json({ error: refusal }, 409)
  }
})
