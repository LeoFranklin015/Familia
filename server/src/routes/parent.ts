// Parent surface: deposit into Aave, grant/revoke member scopes with a
// bounded aToken allowance, settle over-cap requests. Every write is one
// batched, sponsored UserOperation from the parent's own 7702 account.
import { Hono, type Context } from 'hono'
import type { Session } from '../wdk.js'
import {
  AAVE, MERCHANTS, aAssetRead, assetRead, buildDepositBatch, buildGrantBatch, buildRevokeBatch,
  canPayFeesInUsdt, erc20, eventArgFromLogs, formatUnits, managerIface, managerRead, MANAGER,
  parseUnits, USDT_PAYMASTER,
} from '../chain.js'
import { mustFamily, record, save } from '../store.js'
import { waitForUserOp } from '../wdk.js'
import { currentSession } from './join.js'

type Env = { Variables: { session: Session } }
export const parentRoutes = new Hono<Env>()

parentRoutes.use('/api/deposit', parentOnly)
parentRoutes.use('/api/members/*', parentOnly)
parentRoutes.use('/api/requests/*', parentOnly)

async function parentOnly(c: Context<Env>, next: () => Promise<void>) {
  const s = currentSession(c)
  if (s?.role !== 'parent') return c.json({ error: 'parent only' }, 403)
  c.set('session', s)
  await next()
}

/**
 * Which account signs a parent's operation.
 *
 * The parent pays their own fees in USD₮ once they hold some and have approved
 * the paymaster — that is the whole point of the token-fee path. Before then
 * (their very first deposit) there is nothing to pay with, so onboarding is
 * sponsored. The choice is made from on-chain state, so it corrects itself.
 */
async function payingAccount(s: Session): Promise<{ account: typeof s.account; feeMode: 'usdt' | 'sponsored' }> {
  if (s.usdtPayer && (await canPayFeesInUsdt(s.address))) {
    return { account: s.usdtPayer, feeMode: 'usdt' }
  }
  return { account: s.account, feeMode: 'sponsored' }
}

/** Sum of the period caps of all active scopes — the bounded allowance the
 *  manager is trusted with. Never type(uint256).max. */
function outstandingCaps(extra: bigint = 0n): bigint {
  const f = mustFamily()
  let total = extra
  for (const m of f.members) {
    if (m.scopeId && !m.revoked && m.caps) total += parseUnits(m.caps.period)
  }
  return total
}

parentRoutes.post('/api/deposit', async (c) => {
  const s = c.get('session')
  const { amount } = await c.req.json()
  const value = parseUnits(amount)

  // A deposit also tops up the parent's USD₮ fee buffer and re-approves the
  // paymaster, so the account can pay its own way from here on. The first one
  // is necessarily sponsored — there is no USD₮ yet to pay a fee with.
  const { account, feeMode } = await payingAccount(s)
  const { hash } = await account.sendTransaction(buildDepositBatch(s.address, value, { withFeeBuffer: true }))
  const result = await waitForUserOp(account, hash)
  if (!result.success) return c.json({ error: 'Deposit did not go through — try again.' }, 502)
  const f = mustFamily()
  f.deposits.push({ amount: String(amount), txHash: result.txHash ?? hash, at: Date.now() })
  save()
  record({ kind: 'deposit', text: `Added ${amount} to the pot`, amount: String(amount), txHash: result.txHash })
  return c.json({ txHash: result.txHash, userOpHash: hash, feeMode })
})

parentRoutes.post('/api/members/:id/grant', async (c) => {
  const s = c.get('session')
  const f = mustFamily()
  const member = f.members.find((m) => m.id === c.req.param('id'))
  if (!member) return c.json({ error: 'unknown member' }, 404)

  const { perTx, period, periodLengthDays = 7, expiryDays = 0 } = await c.req.json()
  const perTxCap = parseUnits(perTx)
  const periodCap = parseUnits(period)
  const periodLength = BigInt(Math.round(periodLengthDays * 86400))
  const expiry = expiryDays > 0 ? BigInt(Math.floor(Date.now() / 1000) + expiryDays * 86400) : 0n

  const batch = buildGrantBatch({
    spender: member.address,
    perTxCap, periodCap, periodLength, expiry,
    newAllowanceTotal: outstandingCaps(periodCap),
  })
  const { account, feeMode } = await payingAccount(s)
  const { hash } = await account.sendTransaction(batch)
  const result = await waitForUserOp(account, hash)
  if (!result.success) return c.json({ error: 'Granting the allowance failed — try again.' }, 502)

  const scopeId = eventArgFromLogs(result.logs, 'Granted', 'id')
  if (!scopeId) return c.json({ error: 'Granted event missing from receipt' }, 500)
  member.scopeId = scopeId
  member.revoked = false
  member.caps = { perTx: String(perTx), period: String(period), periodLength: Number(periodLength), expiry: Number(expiry) }
  member.grantTx = result.txHash
  save()
  record({
    kind: 'allowance',
    text: `${member.name} can spend up to ${perTx} per purchase, ${period} per week`,
    memberId: member.id,
    txHash: result.txHash,
  })
  return c.json({ scopeId, txHash: result.txHash, feeMode })
})

parentRoutes.post('/api/members/:id/revoke', async (c) => {
  const s = c.get('session')
  const f = mustFamily()
  const member = f.members.find((m) => m.id === c.req.param('id'))
  if (!member?.scopeId) return c.json({ error: 'member has no allowance' }, 404)

  member.revoked = true // compute the post-revoke bounded allowance
  const { account, feeMode } = await payingAccount(s)
  const { hash } = await account.sendTransaction(buildRevokeBatch(member.scopeId, outstandingCaps()))
  const result = await waitForUserOp(account, hash)
  if (!result.success) {
    member.revoked = false
    return c.json({ error: 'Revoke failed — try again.' }, 502)
  }
  save()
  record({ kind: 'revoke', text: `${member.name}'s spending turned off`, memberId: member.id, txHash: result.txHash })
  return c.json({ txHash: result.txHash, feeMode })
})

parentRoutes.post('/api/requests/:requestId/:verdict', async (c) => {
  const s = c.get('session')
  const f = mustFamily()
  const req = f.requests.find((r) => r.requestId === c.req.param('requestId'))
  if (!req || req.status !== 'pending') return c.json({ error: 'request is not pending' }, 404)
  const verdict = c.req.param('verdict')
  if (verdict !== 'approve' && verdict !== 'deny') return c.json({ error: 'unknown verdict' }, 400)

  // Approving needs headroom beyond the standing bounded allowance (sum of
  // period caps). Raise it by exactly the request amount, settle, and reset —
  // all in one atomic UserOp, so the allowance is never unbounded and never
  // left inflated.
  const txs = verdict === 'approve'
    ? [
        { to: AAVE.A_ASSET, value: 0n, data: erc20.encodeFunctionData('approve', [MANAGER, outstandingCaps(parseUnits(req.amount))]) },
        { to: MANAGER, value: 0n, data: managerIface.encodeFunctionData('approveRequest', [req.requestId]) },
        { to: AAVE.A_ASSET, value: 0n, data: erc20.encodeFunctionData('approve', [MANAGER, outstandingCaps()]) },
      ]
    : [{ to: MANAGER, value: 0n, data: managerIface.encodeFunctionData('denyRequest', [req.requestId]) }]
  const { account, feeMode } = await payingAccount(s)
  const { hash } = await account.sendTransaction(txs)
  const result = await waitForUserOp(account, hash)
  if (!result.success) return c.json({ error: `Could not ${verdict} — try again.` }, 502)
  req.status = verdict === 'approve' ? 'approved' : 'denied'
  req.txHash = result.txHash
  save()
  const who = f.members.find((m) => m.id === req.memberId)?.name ?? 'A member'
  record({
    kind: verdict === 'approve' ? 'approved' : 'denied',
    text: verdict === 'approve'
      ? `Approved ${who}'s ${req.amount} to ${req.toName}`
      : `Declined ${who}'s ${req.amount} to ${req.toName}`,
    amount: req.amount,
    memberId: req.memberId,
    txHash: result.txHash,
  })
  return c.json({ txHash: result.txHash, feeMode })
})

parentRoutes.get('/api/state', async (c) => {
  const s = currentSession(c)
  if (s?.role !== 'parent') return c.json({ error: 'parent only' }, 403)
  const f = mustFamily()

  const [pool, feeBalance, paysInUsdt] = await Promise.all([
    aAssetRead.balanceOf(s.address) as Promise<bigint>,
    assetRead.balanceOf(s.address) as Promise<bigint>,
    canPayFeesInUsdt(s.address),
  ])
  const members = await Promise.all(
    f.members.map(async (m) => {
      let spendable = '0', spent = '0', resetsAt = 0
      if (m.scopeId && !m.revoked) {
        const [sp, scope, resets] = await Promise.all([
          managerRead.spendable(m.scopeId) as Promise<bigint>,
          managerRead.getScope(m.scopeId),
          managerRead.periodResetsAt(m.scopeId) as Promise<bigint>,
        ])
        spendable = formatUnits(sp)
        spent = formatUnits(scope.spentInPeriod as bigint)
        resetsAt = Number(resets)
      }
      return {
        id: m.id, name: m.name, address: m.address, scopeId: m.scopeId ?? null,
        caps: m.caps ?? null, revoked: Boolean(m.revoked), spendable, spentThisPeriod: spent, resetsAt,
      }
    }),
  )

  return c.json({
    familyName: f.name,
    symbol: AAVE.SYMBOL,
    // The wallet: the parent's own account and the pot it holds. Members
    // never receive any of this.
    wallet: {
      address: s.address,
      pot: formatUnits(pool),
      vault: AAVE.A_ASSET,
      asset: AAVE.ASSET,
      // Fees: the parent pays their own in USD₮ once bootstrapped; members
      // are always sponsored.
      feeBalance: formatUnits(feeBalance),
      feeMode: paysInUsdt ? 'usdt' : 'sponsored',
      paymaster: USDT_PAYMASTER || null,
    },
    pool: formatUnits(pool),
    deposits: f.deposits,
    activity: f.activity,
    members,
    pendingRequests: f.requests.filter((r) => r.status === 'pending').map((r) => ({
      ...r, memberName: f.members.find((m) => m.id === r.memberId)?.name ?? '?',
    })),
    merchants: MERCHANTS,
  })
})
