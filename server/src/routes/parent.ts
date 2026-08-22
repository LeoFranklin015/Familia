// The parent's surface: fund the pot, set and withdraw limits, settle asks.
//
// Reads come from the session. Every write needs the parent's key, presented
// at that moment — these are the operations with no on-chain ceiling behind
// them, so the only guard available is the person themselves.
import { Hono, type Context } from 'hono'
import {
  AAVE, MERCHANTS, aAssetRead, assetRead, buildGrantBatch, buildRevokeBatch,
  canPayFeesInUsdt, erc20, eventArgFromLogs, feeChargedFromLogs, formatUnits,
  managerIface, managerRead, MANAGER, parseUnits, planDeposit, USDT_PAYMASTER,
} from '../chain.js'
import { mustFamily, record, saveFamily, type Family } from '../store.js'
import { waitForUserOp } from '../wdk.js'
import { actAs, AuthError, bodyOf, currentSession } from '../authorize.js'
import { bootstrapStatus } from '../bootstrap.js'

export const parentRoutes = new Hono()

function parentOf(c: Context<any, any, any>) {
  const s = currentSession(c)
  if (s?.role !== 'parent') return null
  return { s, family: mustFamily(s.familyId) }
}

/** Sum of the period caps of every active scope — the bounded allowance the
 *  manager is trusted with. Never type(uint256).max. */
function outstandingCaps(family: Family, extra = 0n): bigint {
  let total = extra
  for (const m of family.members) {
    if (m.scopeId && !m.revoked && m.caps) total += parseUnits(m.caps.period)
  }
  return total
}

/** Wrap a parent write: authorise, act, and translate auth failures into
 *  something the interface can act on. */
async function parentWrite(
  c: Context<any, any, any>,
  fn: (account: Parameters<Parameters<typeof actAs>[2]>[0], family: Family, address: string) => Promise<Response>,
): Promise<Response> {
  const ctx = parentOf(c)
  if (!ctx) return c.json({ error: 'parent only' }, 403)
  try {
    // The parent pays their own fees in USD₮ once they hold some; before that
    // there is nothing to pay with, so the first operation is sponsored.
    const payFeesInUsdt = await canPayFeesInUsdt(ctx.s.address)
    return await actAs(c, { role: 'parent', payFeesInUsdt }, (account) =>
      fn(account, mustFamily(ctx.s.familyId), ctx.s.address))
  } catch (e) {
    if (e instanceof AuthError) return c.json({ error: e.message, needsAuth: e.status === 401 }, e.status)
    throw e
  }
}

parentRoutes.post('/api/deposit', (c) =>
  parentWrite(c, async (account, family, address) => {
    const { amount } = await bodyOf<{ amount: string }>(c)
    const value = parseUnits(String(amount))

    // Deposits supply from what the account already holds; the faucet is
    // visited once, at onboarding, because it allows one mint per day.
    const plan = await planDeposit(address, value)
    if (!plan.ok) return c.json({ error: plan.reason }, 409)

    const { hash } = await account.sendTransaction(plan.txs)
    const result = await waitForUserOp(account, hash)
    if (!result.success) return c.json({ error: 'Deposit did not go through — try again.' }, 502)

    family.deposits.push({ amount: String(amount), txHash: result.txHash ?? hash, at: Date.now() })
    saveFamily(family)
    record(family.id, { kind: 'deposit', text: `Added ${amount} to the pot`, amount: String(amount), txHash: result.txHash })
    return c.json({ txHash: result.txHash, userOpHash: hash, feeCharged: feeChargedFromLogs(result.logs) })
  }))

parentRoutes.post('/api/members/:id/grant', (c) =>
  parentWrite(c, async (account, family) => {
    const member = family.members.find((m) => m.id === c.req.param('id'))
    if (!member) return c.json({ error: 'unknown member' }, 404)

    const { perTx, period, periodLengthDays = 7, expiryDays = 0 } =
      await bodyOf<{ perTx: string; period: string; periodLengthDays?: number; expiryDays?: number }>(c)
    const periodCap = parseUnits(String(period))
    const batch = buildGrantBatch({
      spender: member.address,
      perTxCap: parseUnits(String(perTx)),
      periodCap,
      periodLength: BigInt(Math.round(Number(periodLengthDays) * 86400)),
      expiry: expiryDays > 0 ? BigInt(Math.floor(Date.now() / 1000) + expiryDays * 86400) : 0n,
      newAllowanceTotal: outstandingCaps(family, periodCap),
    })

    const { hash } = await account.sendTransaction(batch)
    const result = await waitForUserOp(account, hash)
    if (!result.success) return c.json({ error: 'Granting the allowance failed — try again.' }, 502)

    const scopeId = eventArgFromLogs(result.logs, 'Granted', 'id')
    if (!scopeId) return c.json({ error: 'Granted event missing from receipt' }, 500)
    member.scopeId = scopeId
    member.revoked = false
    member.caps = {
      perTx: String(perTx), period: String(period),
      periodLength: Math.round(Number(periodLengthDays) * 86400), expiry: 0,
    }
    member.grantTx = result.txHash
    saveFamily(family)
    record(family.id, {
      kind: 'allowance',
      text: `${member.name} can spend up to ${perTx} per purchase, ${period} per week`,
      memberId: member.id, txHash: result.txHash,
    })
    return c.json({ scopeId, txHash: result.txHash, feeCharged: feeChargedFromLogs(result.logs) })
  }))

parentRoutes.post('/api/members/:id/revoke', (c) =>
  parentWrite(c, async (account, family) => {
    const member = family.members.find((m) => m.id === c.req.param('id'))
    if (!member?.scopeId) return c.json({ error: 'member has no allowance' }, 404)

    member.revoked = true // so the recomputed allowance excludes them
    const { hash } = await account.sendTransaction(buildRevokeBatch(member.scopeId, outstandingCaps(family)))
    const result = await waitForUserOp(account, hash)
    if (!result.success) {
      member.revoked = false
      return c.json({ error: 'Revoke failed — try again.' }, 502)
    }
    saveFamily(family)
    record(family.id, { kind: 'revoke', text: `${member.name}'s spending turned off`, memberId: member.id, txHash: result.txHash })
    return c.json({ txHash: result.txHash, feeCharged: feeChargedFromLogs(result.logs) })
  }))

parentRoutes.post('/api/requests/:requestId/:verdict', (c) =>
  parentWrite(c, async (account, family) => {
    const req = family.requests.find((r) => r.requestId === c.req.param('requestId'))
    if (!req || req.status !== 'pending') return c.json({ error: 'request is not pending' }, 404)
    const verdict = c.req.param('verdict')
    if (verdict !== 'approve' && verdict !== 'deny') return c.json({ error: 'unknown verdict' }, 400)

    // Approving needs head-room beyond the standing allowance. Raise it by
    // exactly the request amount, settle, and put it back — one atomic
    // operation, so the allowance is never unbounded and never left inflated.
    const txs = verdict === 'approve'
      ? [
          { to: AAVE.A_ASSET, value: 0n, data: erc20.encodeFunctionData('approve', [MANAGER, outstandingCaps(family, parseUnits(req.amount))]) },
          { to: MANAGER, value: 0n, data: managerIface.encodeFunctionData('approveRequest', [req.requestId]) },
          { to: AAVE.A_ASSET, value: 0n, data: erc20.encodeFunctionData('approve', [MANAGER, outstandingCaps(family)]) },
        ]
      : [{ to: MANAGER, value: 0n, data: managerIface.encodeFunctionData('denyRequest', [req.requestId]) }]

    const { hash } = await account.sendTransaction(txs)
    const result = await waitForUserOp(account, hash)
    if (!result.success) return c.json({ error: `Could not ${verdict} — try again.` }, 502)

    req.status = verdict === 'approve' ? 'approved' : 'denied'
    req.txHash = result.txHash
    saveFamily(family)
    const who = family.members.find((m) => m.id === req.memberId)?.name ?? 'A member'
    record(family.id, {
      kind: verdict === 'approve' ? 'approved' : 'denied',
      text: verdict === 'approve'
        ? `Approved ${who}'s ${req.amount} to ${req.toName}`
        : `Declined ${who}'s ${req.amount} to ${req.toName}`,
      amount: req.amount, memberId: req.memberId, txHash: result.txHash,
    })
    return c.json({ txHash: result.txHash, feeCharged: feeChargedFromLogs(result.logs) })
  }))

/**
 * What an operation will cost, in USD₮, before it is signed.
 *
 * Quoting is a read: it needs no key, because WDK builds and prices the
 * operation without signing it.
 */
parentRoutes.post('/api/quote', async (c) => {
  const ctx = parentOf(c)
  if (!ctx) return c.json({ error: 'parent only' }, 403)
  const { s, family } = ctx

  if (!(await canPayFeesInUsdt(s.address))) {
    return c.json({ feeMode: 'sponsored', fee: '0', symbol: AAVE.SYMBOL })
  }

  const body = await bodyOf<Record<string, unknown>>(c)
  let txs
  try {
    txs = await buildForAction(family, s.address, body)
  } catch (e) {
    // A blocked action is not a broken quote — say what is actually wrong.
    return c.json({ feeMode: 'usdt', fee: null, symbol: AAVE.SYMBOL, blocked: e instanceof Error ? e.message : 'cannot quote that' })
  }
  if (!txs) return c.json({ feeMode: 'sponsored', fee: '0', symbol: AAVE.SYMBOL })

  try {
    const { quoteUnsigned } = await import('../wdk.js')
    const fee = await quoteUnsigned(s.address, txs)
    return c.json({ feeMode: 'usdt', fee: formatUnits(fee), symbol: AAVE.SYMBOL, paidIn: 'USD₮', steps: describe(txs) })
  } catch (e) {
    return c.json({ feeMode: 'usdt', fee: null, symbol: AAVE.SYMBOL, error: e instanceof Error ? e.message : 'quote failed' })
  }
})

/** Plain-language description of a batch. Approvals are plumbing — batching is
 *  what lets them be invisible, so they aren't listed as decisions. */
function describe(txs: Array<{ to: string; data: string }>): string[] {
  const approve = erc20.getFunction('approve')!.selector
  return txs.flatMap((tx) => {
    const to = tx.to.toLowerCase()
    if (tx.data.slice(0, 10) === approve) return []
    if (to === AAVE.FAUCET.toLowerCase()) return [`Get test ${AAVE.SYMBOL}`]
    if (to === AAVE.POOL.toLowerCase()) return ['Move it into Aave']
    if (to === MANAGER.toLowerCase()) return ['Set the limits on-chain']
    return [`Call ${tx.to.slice(0, 10)}…`]
  })
}

/** The same batch the matching action would send, so a quote is never about a
 *  different transaction. */
async function buildForAction(family: Family, address: string, body: Record<string, unknown>) {
  switch (body.action) {
    case 'deposit': {
      const plan = await planDeposit(address, parseUnits(String(body.amount ?? '0')))
      if (!plan.ok) throw new Error(plan.reason)
      return plan.txs
    }
    case 'grant': {
      const member = family.members.find((m) => m.id === body.memberId)
      if (!member) throw new Error('unknown member')
      const periodCap = parseUnits(String(body.period ?? '0'))
      return buildGrantBatch({
        spender: member.address,
        perTxCap: parseUnits(String(body.perTx ?? '0')),
        periodCap,
        periodLength: BigInt(Math.round(Number(body.periodLengthDays ?? 7) * 86400)),
        expiry: 0n,
        newAllowanceTotal: outstandingCaps(family, periodCap),
      })
    }
    case 'revoke': {
      const member = family.members.find((m) => m.id === body.memberId)
      if (!member?.scopeId) throw new Error('member has no allowance')
      return buildRevokeBatch(member.scopeId, outstandingCaps(family))
    }
    default:
      return null
  }
}

parentRoutes.get('/api/state', async (c) => {
  const ctx = parentOf(c)
  if (!ctx) return c.json({ error: 'parent only' }, 403)
  const { s, family } = ctx

  const [pool, loose, paysInUsdt] = await Promise.all([
    aAssetRead.balanceOf(s.address) as Promise<bigint>,
    assetRead.balanceOf(s.address) as Promise<bigint>,
    canPayFeesInUsdt(s.address),
  ])

  const members = await Promise.all(family.members.map(async (m) => {
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
  }))

  return c.json({
    familyName: family.name,
    symbol: AAVE.SYMBOL,
    wallet: {
      address: s.address,
      pot: formatUnits(pool),
      loose: formatUnits(loose),
      vault: AAVE.A_ASSET,
      asset: AAVE.ASSET,
      feeMode: paysInUsdt ? 'usdt' : 'sponsored',
      paymaster: USDT_PAYMASTER || null,
      setup: bootstrapStatus(s.address),
    },
    activity: family.activity,
    members,
    pendingRequests: family.requests.filter((r) => r.status === 'pending').map((r) => ({
      ...r, memberName: family.members.find((m) => m.id === r.memberId)?.name ?? '?',
    })),
    merchants: MERCHANTS,
  })
})
