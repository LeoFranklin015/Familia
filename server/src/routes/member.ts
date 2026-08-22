// Member surface: one truthful number (spendable), spend within it, or ask
// above it. The over-cap path never fails — it becomes a request on-chain.
import { Hono, type Context } from 'hono'
import { ethers } from 'ethers'
import {
  AAVE, MERCHANTS, eventArgFromLogs, formatUnits, humanizeManagerRevert, managerIface, managerRead, MANAGER, parseUnits,
} from '../chain.js'
import { mustFamily, record, save } from '../store.js'
import { waitForUserOp } from '../wdk.js'
import { currentSession } from './join.js'

export const memberRoutes = new Hono()

const REQUEST_TTL_S = 24 * 3600

function memberOf(c: Context<any, any, any>) {
  const s = currentSession(c)
  if (s?.role !== 'member' || !s.memberId) return null
  const member = mustFamily().members.find((m) => m.id === s.memberId)
  return member ? { s, member } : null
}

memberRoutes.get('/api/me', async (c) => {
  const ctx = memberOf(c)
  if (!ctx) return c.json({ error: 'member only' }, 403)
  const { member } = ctx
  const f = mustFamily()

  let spendable = '0', resetsAt = 0, spent = '0'
  if (member.scopeId && !member.revoked) {
    const [sp, scope, resets] = await Promise.all([
      managerRead.spendable(member.scopeId) as Promise<bigint>,
      managerRead.getScope(member.scopeId),
      managerRead.periodResetsAt(member.scopeId) as Promise<bigint>,
    ])
    spendable = formatUnits(sp)
    spent = formatUnits(scope.spentInPeriod as bigint)
    resetsAt = Number(resets)
  }

  // Deliberately narrow: a member is never told the size of the family pot,
  // nor anything about other members. `limit` is their own per-purchase
  // ceiling — what the Send/Ask affordance is built from — not a balance.
  return c.json({
    name: member.name,
    familyName: f.name,
    symbol: AAVE.SYMBOL,
    hasAllowance: Boolean(member.scopeId && !member.revoked),
    limit: member.caps?.perTx ?? null,
    headroom: spendable,
    spentThisPeriod: spent,
    resetsAt,
    merchants: MERCHANTS,
    myRequests: f.requests.filter((r) => r.memberId === member.id),
    activity: f.activity.filter((a) => a.memberId === member.id && (a.kind === 'payment' || a.kind === 'ask' || a.kind === 'approved' || a.kind === 'denied')),
  })
})

memberRoutes.post('/api/spend', async (c) => {
  const ctx = memberOf(c)
  if (!ctx) return c.json({ error: 'member only' }, 403)
  const { s, member } = ctx
  if (!member.scopeId) {
    return c.json({ error: 'You have no spending allowance yet — ask a parent.' }, 409)
  }

  // `force` skips the local pre-checks so the on-chain enforcement itself is
  // demonstrable — the manager reverts (e.g. Revoked()) at simulation.
  const { to, amount, force = false } = await c.req.json()
  if (!ethers.isAddress(to)) return c.json({ error: 'Pick a real recipient.' }, 400)
  const value = parseUnits(amount)
  if (value <= 0n) return c.json({ error: 'Enter an amount above zero.' }, 400)

  const scope = await managerRead.getScope(member.scopeId)
  if (scope.revoked && !force) return c.json({ error: 'Your spending was turned off by a parent.' }, 409)

  const spendableNow = force ? value : ((await managerRead.spendable(member.scopeId)) as bigint)

  if (value <= spendableNow) {
    // Within limits: the member's own account calls spend(); funds leave the
    // parent's Aave position and reach the merchant in this one transaction.
    try {
      const { hash } = await s.account.sendTransaction({
        to: MANAGER, value: 0n, data: managerIface.encodeFunctionData('spend', [member.scopeId, to, value]),
      })
      const result = await waitForUserOp(s.account, hash)
      if (!result.success) return c.json({ error: 'The payment reverted on-chain — nothing was spent.' }, 502)
      record({
        kind: 'payment',
        text: `${member.name} paid ${amount} to ${merchantName(to)}`,
        amount: String(amount), memberId: member.id, txHash: result.txHash,
      })
      return c.json({ kind: 'spent', txHash: result.txHash, userOpHash: hash })
    } catch (err) {
      const human = humanizeManagerRevert(err)
      if (human) return c.json({ error: human, onchainRevert: true }, 409)
      throw err
    }
  }

  // Over the cap: do NOT fail — turn it into an on-chain request.
  const { hash } = await s.account.sendTransaction({
    to: MANAGER, value: 0n,
    data: managerIface.encodeFunctionData('requestSpend', [member.scopeId, to, value, REQUEST_TTL_S]),
  })
  const result = await waitForUserOp(s.account, hash)
  if (!result.success) return c.json({ error: 'Could not send the ask — try again.' }, 502)
  const requestId = eventArgFromLogs(result.logs, 'SpendRequested', 'requestId')
  if (!requestId) return c.json({ error: 'SpendRequested event missing from receipt' }, 500)

  const f = mustFamily()
  f.requests.push({
    requestId,
    memberId: member.id,
    to,
    toName: merchantName(to),
    amount: String(amount),
    status: 'pending',
    createdAt: Date.now(),
    txHash: result.txHash,
  })
  save()
  record({
    kind: 'ask',
    text: `${member.name} asked to pay ${amount} to ${merchantName(to)}`,
    amount: String(amount), memberId: member.id, txHash: result.txHash,
  })
  return c.json({ kind: 'asked', requestId, txHash: result.txHash })
})

function merchantName(address: string): string {
  return MERCHANTS.find((m) => m.address.toLowerCase() === address.toLowerCase())?.name
    ?? `${address.slice(0, 6)}…${address.slice(-4)}`
}
