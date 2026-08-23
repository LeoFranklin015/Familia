// Setting, changing and withdrawing what one person may spend.
import { Hono } from 'hono'
import { eventArgFromLogs, feeChargedFromLogs } from '../../chain.js'
import { record, updateFamily } from '../../store.js'
import { waitForUserOp } from '../../wdk.js'
import { bodyOf } from '../../authorize.js'
import { parentWrite } from '../guard.js'
import { allowlistPlan, grantPlan, revokePlan, type Limits } from './plans.js'

export const limitRoutes = new Hono()

limitRoutes.post('/api/members/:id/grant', (c) =>
  parentWrite(c, async (account, family, address) => {
    const member = family.members.find((m) => m.id === c.req.param('id'))
    if (!member) return c.json({ error: 'unknown member' }, 404)

    const limits = await bodyOf<Limits>(c)
    const { hash } = await account.sendTransaction(await grantPlan(family, address, member, limits))
    const result = await waitForUserOp(account, hash)
    if (!result.success) return c.json({ error: 'Granting the allowance failed. Try again.' }, 502)

    const scopeId = eventArgFromLogs(result.logs, 'Granted', 'id')
    if (!scopeId) return c.json({ error: 'Granted event missing from receipt' }, 500)

    await updateFamily(family.id, (f) => {
      const m = f.members.find((x) => x.id === member.id)
      if (!m) return
      m.scopeId = scopeId
      m.revoked = false
      m.caps = {
        perTx: String(limits.perTx),
        period: String(limits.period),
        periodLength: Math.round(Number(limits.periodLengthDays ?? 7) * 86400),
        expiry: 0,
      }
    })
    await record(family.id, {
      kind: 'allowance',
      text: `${member.name}'s limits set: ${limits.perTx} a purchase, ${limits.period} a week`,
      memberId: member.id,
      txHash: result.txHash,
    })
    return c.json({ scopeId, txHash: result.txHash, feeCharged: feeChargedFromLogs(result.logs) })
  }))

limitRoutes.post('/api/members/:id/revoke', (c) =>
  parentWrite(c, async (account, family) => {
    const member = family.members.find((m) => m.id === c.req.param('id'))
    if (!member?.scopeId) return c.json({ error: 'member has no allowance' }, 404)

    const { hash } = await account.sendTransaction(revokePlan(family, member))
    const result = await waitForUserOp(account, hash)
    if (!result.success) return c.json({ error: 'Revoke failed. Try again.' }, 502)

    await updateFamily(family.id, (f) => {
      const m = f.members.find((x) => x.id === member.id)
      if (m) m.revoked = true
    })
    await record(family.id, {
      kind: 'revoke',
      text: `${member.name}'s spending turned off`,
      memberId: member.id,
      txHash: result.txHash,
    })
    return c.json({ txHash: result.txHash, feeCharged: feeChargedFromLogs(result.logs) })
  }))

/**
 * Where one person may pay.
 *
 * The shape the contract actually models: `allowlist[scopeId][address]`, one
 * list per scope, and a scope belongs to one member. Turning it off empties
 * their list, because an empty allowlist is already how the contract spells
 * "anyone".
 */
limitRoutes.post('/api/members/:id/allowlist', (c) =>
  parentWrite(c, async (account, family) => {
    const member = family.members.find((m) => m.id === c.req.param('id'))
    if (!member) return c.json({ error: 'unknown member' }, 404)
    if (!member.scopeId || member.revoked) {
      return c.json({ error: 'Give them a limit first, then choose where it can go.' }, 409)
    }

    const { only, allowed = [] } = await bodyOf<{ only: boolean; allowed?: string[] }>(c)
    const on = Boolean(only)
    const plan = allowlistPlan(family, member, on, allowed)

    const unchanged = !plan.add.length && !plan.drop.length && on === Boolean(member.allowOnly)
    if (unchanged) return c.json({ onchain: false })

    const result = plan.txs.length
      ? await waitForUserOp(account, (await account.sendTransaction(plan.txs)).hash)
      : null
    if (result && !result.success) {
      return c.json({ error: 'Setting the list on-chain failed. Nothing changed.' }, 502)
    }

    await updateFamily(family.id, (f) => {
      const m = f.members.find((x) => x.id === member.id)
      if (m) { m.allowOnly = on; m.allowed = plan.next }
    })
    if (result) {
      await record(family.id, {
        kind: 'allowance',
        memberId: member.id,
        text: on
          ? `${member.name} can pay ${plan.next.length} ${plan.next.length === 1 ? 'place' : 'places'}`
          : `${member.name} can pay anyone again`,
        txHash: result.txHash,
      })
    }
    return c.json({
      onchain: Boolean(result),
      txHash: result?.txHash,
      feeCharged: result && feeChargedFromLogs(result.logs),
    })
  }))
