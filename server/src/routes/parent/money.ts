// Money the guardian moves: into Aave, out to someone, or on a child's behalf.
import { Hono } from 'hono'
import { ethers } from 'ethers'
import { feeChargedFromLogs, parseUnits, planDeposit, planGuardianPay } from '../../chain.js'
import { record, updateFamily } from '../../store.js'
import { waitForUserOp } from '../../wdk.js'
import { bodyOf } from '../../authorize.js'
import { parentWrite } from '../guard.js'
import { payeeName } from '../../lib/names.js'
import { settlePlan } from './plans.js'

export const moneyRoutes = new Hono()

/** Asks carry a 24h on-chain TTL, the same one `requestSpend` was given. */
const REQUEST_TTL_MS = 24 * 3600 * 1000
const hasExpired = (req: { createdAt: number }) => Date.now() - req.createdAt > REQUEST_TTL_MS

moneyRoutes.post('/api/deposit', (c) =>
  parentWrite(c, async (account, family, address) => {
    const { amount } = await bodyOf<{ amount: string }>(c)
    const value = parseUnits(String(amount))
    if (value <= 0n) return c.json({ error: 'Enter an amount above zero.' }, 400)

    // Deposits supply from what the account already holds. The faucet is
    // visited once, at onboarding, because it allows one mint per day.
    const plan = await planDeposit(address, value)
    if (!plan.ok) return c.json({ error: plan.reason }, 409)

    const { hash } = await account.sendTransaction(plan.txs)
    const result = await waitForUserOp(account, hash)
    if (!result.success) return c.json({ error: 'Deposit did not go through. Try again.' }, 502)

    await record(family.id, {
      kind: 'deposit',
      text: `You added ${amount} to the balance`,
      amount: String(amount),
      txHash: result.txHash,
    })
    return c.json({ txHash: result.txHash, feeCharged: feeChargedFromLogs(result.logs) })
  }))

/**
 * The guardian paying someone straight out of the household position.
 *
 * No scope, no allowlist, no limit: they are the funder, and the money is
 * theirs. Aave enforces the only ceiling there is.
 */
moneyRoutes.post('/api/pay', (c) =>
  parentWrite(c, async (account, family, address) => {
    const { to, amount } = await bodyOf<{ to: string; amount: string }>(c)
    if (!ethers.isAddress(to)) return c.json({ error: "That doesn't look like an address." }, 400)
    const value = parseUnits(String(amount))
    if (value <= 0n) return c.json({ error: 'Enter an amount above zero.' }, 400)

    const plan = await planGuardianPay(address, to, value)
    if (!plan.ok) return c.json({ error: plan.reason }, 409)

    const { hash } = await account.sendTransaction(plan.txs)
    const result = await waitForUserOp(account, hash)
    if (!result.success) return c.json({ error: 'The payment reverted on-chain. Nothing was spent.' }, 502)

    await record(family.id, {
      kind: 'payment',
      text: `You paid ${amount} to ${payeeName(family, to)}`,
      amount: String(amount),
      txHash: result.txHash,
    })
    return c.json({ txHash: result.txHash, feeCharged: feeChargedFromLogs(result.logs) })
  }))

moneyRoutes.post('/api/requests/:requestId/:verdict', (c) =>
  parentWrite(c, async (account, family) => {
    const req = family.requests.find((r) => r.requestId === c.req.param('requestId'))
    if (!req || req.status !== 'pending') return c.json({ error: 'request is not pending' }, 404)
    const verdict = c.req.param('verdict')
    if (verdict !== 'approve' && verdict !== 'deny') return c.json({ error: 'unknown verdict' }, 400)

    // Approving a lapsed ask reverts on-chain and can never succeed. Retire it
    // rather than offering a retry that will fail identically. Denying still
    // works, since `denyRequest` does not check expiry.
    if (verdict === 'approve' && hasExpired(req)) {
      await updateFamily(family.id, (f) => {
        const r = f.requests.find((x) => x.requestId === req.requestId)
        if (r) r.status = 'expired'
      })
      return c.json({ error: 'That ask is more than a day old and has lapsed. Ask them to try again.' }, 409)
    }

    const txs = settlePlan(family, req.requestId, parseUnits(req.amount), verdict === 'approve')
    const { hash } = await account.sendTransaction(txs)
    const result = await waitForUserOp(account, hash)
    if (!result.success) return c.json({ error: `Could not ${verdict}. Try again.` }, 502)

    await updateFamily(family.id, (f) => {
      const r = f.requests.find((x) => x.requestId === req.requestId)
      if (!r) return
      r.status = verdict === 'approve' ? 'approved' : 'denied'
      r.txHash = result.txHash
    })
    const who = family.members.find((m) => m.id === req.memberId)?.name ?? 'A member'
    await record(family.id, {
      kind: verdict === 'approve' ? 'approved' : 'denied',
      text: verdict === 'approve'
        ? `Approved ${who}'s ${req.amount} to ${req.toName}`
        : `Declined ${who}'s ${req.amount} to ${req.toName}`,
      amount: req.amount,
      memberId: req.memberId,
      txHash: result.txHash,
    })
    return c.json({ txHash: result.txHash, feeCharged: feeChargedFromLogs(result.logs) })
  }))

export { hasExpired }
