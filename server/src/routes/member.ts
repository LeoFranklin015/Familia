// The member's surface: one truthful number, spend within it, or ask above it.
//
// Reads come from the session. The payment itself needs the member's own key,
// presented at the moment they press pay — the same confirmation a phone asks
// for before any other payment.
import { Hono, type Context } from 'hono'
import { ethers } from 'ethers'
import {
  AAVE, eventArgFromLogs, formatUnits, humanizeManagerRevert,
  managerIface, managerRead, MANAGER, parseUnits, spentInCurrentPeriod,
} from '../chain.js'
import { mustFamily, record, updateFamily, type Family } from '../store.js'
import { waitForUserOp } from '../wdk.js'
import { actAs, AuthError, bodyOf, currentSession } from '../authorize.js'

export const memberRoutes = new Hono()

const REQUEST_TTL_S = 24 * 3600

/** A name for an address if the household has one, otherwise the address
 *  itself, shortened. What ends up in the history either way. */
function payeeName(family: Family, address: string): string {
  return family.recipients.find((r) => r.address.toLowerCase() === address.toLowerCase())?.name
    ?? `${address.slice(0, 6)}…${address.slice(-4)}`
}

/** Same as the parent side: a stale cookie is not a role error. */
async function refuse(c: Context<any, any, any>) {
  return (await currentSession(c))
    ? c.json({ error: 'This account cannot spend from that household.' }, 403)
    : c.json({ error: 'Your session has ended. Sign in again.', sessionEnded: true }, 401)
}

async function memberOf(c: Context<any, any, any>) {
  const s = await currentSession(c)
  if (s?.role !== 'member' || !s.memberId) return null
  const family = await mustFamily(s.familyId)
  const member = family.members.find((m) => m.id === s.memberId)
  return member ? { s, family, member } : null
}

memberRoutes.get('/api/me', async (c) => {
  const ctx = await memberOf(c)
  if (!ctx) return refuse(c)
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

memberRoutes.post('/api/spend', async (c) => {
  const ctx = await memberOf(c)
  if (!ctx) return refuse(c)
  const { family, member } = ctx
  if (!member.scopeId) return c.json({ error: 'You have no spending allowance yet. Ask a parent.' }, 409)

  // `force` skips this app's own pre-checks so the on-chain enforcement is
  // demonstrable: the manager reverts at simulation, and we decode it.
  const { to, amount, force = false } = await bodyOf<{ to: string; amount: string; force?: boolean }>(c)
  if (!ethers.isAddress(to)) return c.json({ error: 'Pick a real recipient.' }, 400)
  const value = parseUnits(String(amount))
  if (value <= 0n) return c.json({ error: 'Enter an amount above zero.' }, 400)

  const scope = await managerRead.getScope(member.scopeId)
  if (scope.revoked && !force) return c.json({ error: 'Your spending was turned off by a parent.' }, 409)
  const spendableNow = force ? value : ((await managerRead.spendable(member.scopeId)) as bigint)

  try {
    return await actAs(c, { role: 'member' }, async (account) => {
      if (value <= spendableNow) {
        // Within limits: the member's own account calls spend(), and the money
        // leaves the parent's Aave position for the merchant in that one
        // transaction. Members are sponsored — a child should never need a
        // token balance to spend an allowance.
        try {
          const { hash } = await account.sendTransaction({
            to: MANAGER, value: 0n,
            data: managerIface.encodeFunctionData('spend', [member.scopeId, to, value]),
          })
          const result = await waitForUserOp(account, hash)
          if (!result.success) return c.json({ error: 'The payment reverted on-chain. Nothing was spent.' }, 502)
          await record(family.id, {
            kind: 'payment', text: `${member.name} paid ${amount} to ${payeeName(family, to)}`,
            amount: String(amount), memberId: member.id, txHash: result.txHash,
          })
          return c.json({ kind: 'spent', txHash: result.txHash, userOpHash: hash })
        } catch (err) {
          const human = humanizeManagerRevert(err)
          if (human) return c.json({ error: human, onchainRevert: true }, 409)
          throw err
        }
      }

      // Over the cap: this does not fail, it becomes an on-chain request.
      const { hash } = await account.sendTransaction({
        to: MANAGER, value: 0n,
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
          requestId, memberId: member.id, to, toName: payeeName(family, to),
          amount: String(amount), status: 'pending', createdAt: Date.now(), txHash: result.txHash,
        })
      })
      await record(family.id, {
        kind: 'ask', text: `${member.name} asked to pay ${amount} to ${payeeName(family, to)}`,
        amount: String(amount), memberId: member.id, txHash: result.txHash,
      })
      return c.json({ kind: 'asked', requestId, txHash: result.txHash })
    })
  } catch (e) {
    if (e instanceof AuthError) return c.json({ error: e.message, needsAuth: e.status === 401 }, e.status)
    throw e
  }
})
