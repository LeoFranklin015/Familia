// The member's surface: one truthful number, spend within it, or ask above it.
//
// Reads come from the session. The payment itself needs the member's own key,
// presented at the moment they press pay — the same confirmation a phone asks
// for before any other payment.
import { Hono } from 'hono'
import { ethers } from 'ethers'
import {
  AAVE, eventArgFromLogs, formatUnits, humanizeManagerRevert,
  managerIface, managerRead, MANAGER, parseUnits, spentInCurrentPeriod,
} from '../chain.js'
import { record, updateFamily, type Member } from '../store.js'
import { waitForUserOp } from '../wdk.js'
import { bodyOf } from '../authorize.js'
import { memberOf, memberWrite, refuseMember } from './guard.js'
import { payeeName } from '../lib/names.js'

export const memberRoutes = new Hono()

const REQUEST_TTL_S = 24 * 3600

memberRoutes.get('/api/me', async (c) => {
  const ctx = await memberOf(c)
  if (!ctx) return refuseMember(c)
  const { family, member } = ctx

  let spendable = '0', resetsAt = 0, spent = '0'
  if (member.scopeId && !member.revoked) {
    const [sp, scope, resets] = await Promise.all([
      managerRead.spendable(member.scopeId) as Promise<bigint>,
      managerRead.getScope(member.scopeId),
      managerRead.periodResetsAt(member.scopeId) as Promise<bigint>,
    ])
    spendable = formatUnits(sp)
    spent = formatUnits(spentInCurrentPeriod(scope, resets))
    resetsAt = Number(resets)
  }

  // Deliberately narrow: a member is never told the size of the household
  // balance, nor anything about anyone else. `limit` is their own
  // per-purchase ceiling — what the Pay/Ask affordance is built from — and
  // `period` is their own weekly one. Neither is a balance.
  return c.json({
    name: member.name,
    familyName: family.name,
    symbol: AAVE.SYMBOL,
    hasAllowance: Boolean(member.scopeId && !member.revoked),
    revoked: Boolean(member.revoked),
    limit: member.caps?.perTx ?? null,
    period: member.caps?.period ?? null,
    headroom: spendable,
    spentThisPeriod: spent,
    resetsAt,
    // The whole book, so any address in their history resolves to a name.
    recipients: family.recipients,
    // Their own list, which is the one the contract will hold them to.
    allowOnly: Boolean(member.allowOnly),
    allowed: member.allowed ?? [],
    myRequests: family.requests.filter((r) => r.memberId === member.id),
    activity: family.activity.filter(
      (a) => a.memberId === member.id && ['payment', 'ask', 'approved', 'denied'].includes(a.kind),
    ),
  })
})

/**
 * Pay, or ask.
 *
 * One route, because from the member's side it is one gesture. Which of the
 * two it becomes is the contract's rule, not a preference: `spend` enforces
 * the caps and the allowlist and reverts, while `requestSpend` enforces
 * neither — and neither does the guardian's `approveRequest`. That asymmetry
 * is the contract saying a list bounds what a *spender* may do unilaterally
 * while the funder can always override, which is exactly "ask someone at
 * home".
 */
memberRoutes.post('/api/spend', (c) =>
  memberWrite(c, async (account, family, member) => {
    if (!member.scopeId) {
      return c.json({ error: 'You have no spending allowance yet. Ask a parent.' }, 409)
    }

    // `force` skips this app's own pre-checks so the on-chain enforcement is
    // demonstrable: the manager reverts at simulation, and we decode it.
    const { to, amount, force = false } =
      await bodyOf<{ to: string; amount: string; force?: boolean }>(c)
    if (!ethers.isAddress(to)) return c.json({ error: 'Pick a real recipient.' }, 400)

    const value = parseUnits(String(amount))
    if (value <= 0n) return c.json({ error: 'Enter an amount above zero.' }, 400)

    const scope = await managerRead.getScope(member.scopeId)
    if (scope.revoked && !force) {
      return c.json({ error: 'Your spending was turned off by a parent.' }, 409)
    }

    const spendable = force ? value : ((await managerRead.spendable(member.scopeId)) as bigint)
    // Decided here rather than by amount alone: an off-list payment that is
    // within the caps would otherwise take the `spend` path and revert.
    const outside = isOffList(member, to)
    const name = payeeName(family, to)

    if (value <= spendable && !outside) {
      // The member's own account calls `spend`, and the money leaves the
      // guardian's Aave position for the shop in that one transaction.
      try {
        const { hash } = await account.sendTransaction({
          to: MANAGER,
          value: 0n,
          data: managerIface.encodeFunctionData('spend', [member.scopeId, to, value]),
        })
        const result = await waitForUserOp(account, hash)
        if (!result.success) {
          return c.json({ error: 'The payment reverted on-chain. Nothing was spent.' }, 502)
        }
        await record(family.id, {
          kind: 'payment',
          text: `${member.name} paid ${amount} to ${name}`,
          amount: String(amount),
          memberId: member.id,
          txHash: result.txHash,
        })
        return c.json({ kind: 'spent', txHash: result.txHash })
      } catch (err) {
        // The manager's own named errors, in words. This is the path that
        // shows the limits belong to the contract rather than to the app.
        const human = humanizeManagerRevert(err)
        if (human) return c.json({ error: human }, 409)
        throw err
      }
    }

    const { hash } = await account.sendTransaction({
      to: MANAGER,
      value: 0n,
      data: managerIface.encodeFunctionData('requestSpend', [member.scopeId, to, value, REQUEST_TTL_S]),
    })
    const result = await waitForUserOp(account, hash)
    if (!result.success) return c.json({ error: 'Could not send the ask. Try again.' }, 502)

    const requestId = eventArgFromLogs(result.logs, 'SpendRequested', 'requestId')
    if (!requestId) return c.json({ error: 'SpendRequested event missing from receipt' }, 500)

    // Atomic: a guardian may well be mid-grant on the other phone, and a
    // whole-document overwrite here would erase whatever they just wrote.
    await updateFamily(family.id, (f) => {
      f.requests.push({
        requestId,
        memberId: member.id,
        to,
        toName: name,
        amount: String(amount),
        status: 'pending',
        createdAt: Date.now(),
        txHash: result.txHash,
        // So the guardian is told they would be overriding a restriction,
        // not merely approving a large amount.
        offList: outside,
      })
    })
    await record(family.id, {
      kind: 'ask',
      text: outside
        ? `${member.name} asked to pay ${amount} to ${name}, outside their places`
        : `${member.name} asked to pay ${amount} to ${name}`,
      amount: String(amount),
      memberId: member.id,
      txHash: result.txHash,
    })
    return c.json({ kind: 'asked', requestId, txHash: result.txHash })
  }))

/** Somewhere this member may not pay on their own. */
function isOffList(member: Member, to: string): boolean {
  return Boolean(member.allowOnly)
    && !(member.allowed ?? []).some((a) => a.toLowerCase() === to.toLowerCase())
}
