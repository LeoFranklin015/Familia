// Parent surface: deposit into Aave, grant/revoke member scopes with a
// bounded aToken allowance, settle over-cap requests. Every write is one
// batched, sponsored UserOperation from the parent's own 7702 account.
import { Hono, type Context } from 'hono'
import type { Session } from '../wdk.js'
import {
  AAVE, MERCHANTS, aAssetRead, assetRead, buildGrantBatch, buildRevokeBatch,
  canPayFeesInUsdt, erc20, eventArgFromLogs, feeChargedFromLogs, formatUnits, managerIface,
  managerRead, MANAGER, parseUnits, planDeposit, USDT_PAYMASTER,
} from '../chain.js'
import { mustFamily, record, save } from '../store.js'
import { bootstrapParent, bootstrapStatus } from '../bootstrap.js'
import { waitForUserOp } from '../wdk.js'
import { currentSession } from './join.js'

type Env = { Variables: { session: Session } }
export const parentRoutes = new Hono<Env>()

parentRoutes.use('/api/quote', parentOnly)
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

/**
 * What this operation will cost, quoted in USD₮ before it is signed.
 *
 * This is WDK's own `quoteSendTransaction` against the exact batch that would
 * be sent, through our USD₮ paymaster — not an estimate we invent. If the
 * account cannot pay in USD₮ yet (its very first operation), the answer is
 * honestly "sponsored, nothing".
 */
parentRoutes.post('/api/quote', async (c) => {
  const s = c.get('session')
  const body = await c.req.json().catch(() => ({}))
  const { account, feeMode } = await payingAccount(s)
  if (feeMode === 'sponsored') return c.json({ feeMode, fee: '0', symbol: AAVE.SYMBOL })

  let txs
  try {
    txs = await buildForAction(s, body)
  } catch (e) {
    // A blocked action (e.g. the faucet timelock) is not a broken quote — say
    // what's actually wrong instead of showing a fee we can't compute.
    return c.json({ feeMode, fee: null, symbol: AAVE.SYMBOL, blocked: e instanceof Error ? e.message : 'cannot quote that' })
  }
  if (!txs) return c.json({ feeMode: 'sponsored', fee: '0', symbol: AAVE.SYMBOL })

  try {
    const quote = await account.quoteSendTransaction(txs)
    return c.json({
      feeMode, fee: formatUnits(quote.fee), symbol: AAVE.SYMBOL, paidIn: 'USD₮',
      // What this one operation is actually going to do on-chain, so the
      // faucet mint is never a silent side effect.
      steps: describe(txs),
    })
  } catch (e) {
    // A quote can fail for real reasons (the paymaster refusing, no allowance).
    // Say so rather than showing a made-up number.
    return c.json({ feeMode, fee: null, symbol: AAVE.SYMBOL, error: e instanceof Error ? e.message : 'quote failed' })
  }
})

/** Plain-language description of a batch, by target and selector, so the UI can
 *  show every call the single operation makes — including a faucet mint. */
function describe(txs: Array<{ to: string; data: string }>): string[] {
  const approve = erc20.getFunction('approve')!.selector
  return txs.flatMap((tx) => {
    const to = tx.to.toLowerCase()
    // Approvals are plumbing. Batching is precisely what lets them be
    // invisible, so they aren't listed as things the person is deciding.
    if (tx.data.slice(0, 10) === approve) return []
    if (to === AAVE.FAUCET.toLowerCase()) return [`Get test ${AAVE.SYMBOL}`]
    if (to === AAVE.POOL.toLowerCase()) return [`Move it into Aave`]
    if (to === MANAGER.toLowerCase()) return [`Set the limits on-chain`]
    return [`Call ${tx.to.slice(0, 10)}…`]
  })
}

/** The same batch the corresponding action would send, so a quote is never a
 *  guess about a different transaction. */
async function buildForAction(s: Session, body: Record<string, unknown>) {
  const f = mustFamily()
  switch (body.action) {
    case 'deposit': {
      const plan = await planDeposit(s.address, parseUnits(String(body.amount ?? '0')))
      if (!plan.ok) throw new Error(plan.reason)
      return plan.txs
    }
    case 'grant': {
      const member = f.members.find((m) => m.id === body.memberId)
      if (!member) throw new Error('unknown member')
      const periodCap = parseUnits(String(body.period ?? '0'))
      return buildGrantBatch({
        spender: member.address,
        perTxCap: parseUnits(String(body.perTx ?? '0')),
        periodCap,
        periodLength: BigInt(Math.round(Number(body.periodLengthDays ?? 7) * 86400)),
        expiry: 0n,
        newAllowanceTotal: outstandingCaps(periodCap),
      })
    }
    case 'revoke': {
      const member = f.members.find((m) => m.id === body.memberId)
      if (!member?.scopeId) throw new Error('member has no allowance')
      return buildRevokeBatch(member.scopeId, outstandingCaps())
    }
    default:
      return null
  }
}

parentRoutes.post('/api/deposit', async (c) => {
  const s = c.get('session')
  const { amount } = await c.req.json()
  const value = parseUnits(amount)

  // A deposit supplies from what the account already holds and only visits the
  // faucet when it must — the faucet permits one mint per address per period,
  // so minting on every deposit would work exactly once.
  const plan = await planDeposit(s.address, value)
  if (!plan.ok) return c.json({ error: plan.reason }, 409)

  const { account, feeMode } = await payingAccount(s)
  const { hash } = await account.sendTransaction(plan.txs)
  const result = await waitForUserOp(account, hash)
  if (!result.success) return c.json({ error: 'Deposit did not go through — try again.' }, 502)
  const f = mustFamily()
  f.deposits.push({ amount: String(amount), txHash: result.txHash ?? hash, at: Date.now() })
  save()
  const feeCharged = feeChargedFromLogs(result.logs)
  record({ kind: 'deposit', text: `Added ${amount} to the pot`, amount: String(amount), txHash: result.txHash })
  return c.json({ txHash: result.txHash, userOpHash: hash, feeMode, feeCharged })
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
  return c.json({ scopeId, txHash: result.txHash, feeMode, feeCharged: feeChargedFromLogs(result.logs) })
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
  return c.json({ txHash: result.txHash, feeMode, feeCharged: feeChargedFromLogs(result.logs) })
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
  return c.json({ txHash: result.txHash, feeMode, feeCharged: feeChargedFromLogs(result.logs) })
})

parentRoutes.get('/api/state', async (c) => {
  const s = currentSession(c)
  if (s?.role !== 'parent') return c.json({ error: 'parent only' }, 403)
  const f = mustFamily()

  // If funding never landed (a refresh mid-onboarding, a restarted server),
  // pick it up again rather than leaving the account stranded.
  const boot = bootstrapStatus(s.address)
  if (boot.status === 'idle' || boot.status === 'failed') {
    if (!(await canPayFeesInUsdt(s.address))) bootstrapParent(s)
  }

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
      // Two balances, because they behave differently: the pot is in Aave and
      // earning, this is loose USD₮ in the account — what deposits come from
      // and what fees are charged against.
      loose: formatUnits(feeBalance),
      feeBalance: formatUnits(feeBalance),
      feeMode: paysInUsdt ? 'usdt' : 'sponsored',
      paymaster: USDT_PAYMASTER || null,
      setup: bootstrapStatus(s.address),
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
