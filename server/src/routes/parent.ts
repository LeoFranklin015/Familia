// The parent's surface: fund the pot, set and withdraw limits, settle asks.
//
// Reads come from the session. Every write needs the parent's key, presented
// at that moment — these are the operations with no on-chain ceiling behind
// them, so the only guard available is the person themselves.
import { Hono, type Context } from 'hono'
import { ethers } from 'ethers'
import {
  AAVE, aAssetRead, assetRead, buildAllowlistBatch, buildGrantBatch, buildRevokeBatch,
  canPayFeesInUsdt, erc20, eventArgFromLogs, feeChargedFromLogs, formatUnits,
  managerIface, managerRead, MANAGER, parseUnits, planDeposit, planGuardianPay,
  poolIface, predictScopeId, spentInCurrentPeriod, supplyApr, USDT_PAYMASTER, depositableAmount, type Tx,
} from '../chain.js'
import { mustFamily, record, updateFamily, type Family, type Member } from '../store.js'
import { waitForUserOp } from '../wdk.js'
import { actAs, AuthError, bodyOf, currentSession } from '../authorize.js'
import { bootstrapStatus } from '../bootstrap.js'

export const parentRoutes = new Hono()

async function parentOf(c: Context<any, any, any>) {
  const s = await currentSession(c)
  if (s?.role !== 'parent') return null
  return { s, family: await mustFamily(s.familyId) }
}

/**
 * Why `parentOf` said no, in words that point somewhere.
 *
 * "parent only" is true and useless: the overwhelmingly common cause is a
 * session that has ended, and being told the wrong role when the real problem
 * is a stale cookie sends you looking in the wrong place. `sessionEnded` also
 * lets the interface act — drop to sign-in rather than report a failure.
 */
async function refuse(c: Context<any, any, any>) {
  return (await currentSession(c))
    ? c.json({ error: 'This account is not the one that set up the household.' }, 403)
    : c.json({ error: 'Your session has ended. Sign in again.', sessionEnded: true }, 401)
}

/**
 * Sum of the period caps of every active scope — the bounded allowance the
 * manager is trusted with. Never type(uint256).max.
 *
 * `replacing` excludes one member, for the case where their old scope is
 * being revoked in the same operation that grants the new one: counting both
 * would inflate the approval by a cap that is about to stop existing.
 */
function outstandingCaps(family: Family, extra = 0n, replacing?: string): bigint {
  let total = extra
  for (const m of family.members) {
    if (m.id === replacing) continue
    if (m.scopeId && !m.revoked && m.caps) total += parseUnits(m.caps.period)
  }
  return total
}

/**
 * One person's allowlist, as it applies to a scope that has never seen it.
 *
 * Nothing needs denying: a fresh scope's allowlist starts empty, which the
 * contract already reads as "any recipient".
 */
function allowlistFor(member: Member, scopeId: string) {
  if (!member.allowOnly || !member.allowed?.length) return []
  return buildAllowlistBatch([scopeId], { allow: member.allowed })
}

/** Wrap a parent write: authorise, act, and translate auth failures into
 *  something the interface can act on. */
async function parentWrite(
  c: Context<any, any, any>,
  fn: (account: Parameters<Parameters<typeof actAs>[2]>[0], family: Family, address: string) => Promise<Response>,
): Promise<Response> {
  const ctx = await parentOf(c)
  if (!ctx) return refuse(c)
  try {
    // The parent pays their own fees in USD₮ once they hold some; before that
    // there is nothing to pay with, so the first operation is sponsored.
    const payFeesInUsdt = await canPayFeesInUsdt(ctx.s.address)
    return await actAs(c, { role: 'parent', payFeesInUsdt }, async (account) =>
      fn(account, await mustFamily(ctx.s.familyId), ctx.s.address))
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
    if (!result.success) return c.json({ error: 'Deposit did not go through. Try again.' }, 502)

    await updateFamily(family.id, (f) => {
      f.deposits.push({ amount: String(amount), txHash: result.txHash ?? hash, at: Date.now() })
    })
    await record(family.id, { kind: 'deposit', text: `You added ${amount} to the balance`, amount: String(amount), txHash: result.txHash })
    return c.json({ txHash: result.txHash, userOpHash: hash, feeCharged: feeChargedFromLogs(result.logs) })
  }))

parentRoutes.post('/api/members/:id/grant', (c) =>
  parentWrite(c, async (account, family, address) => {
    const member = family.members.find((m) => m.id === c.req.param('id'))
    if (!member) return c.json({ error: 'unknown member' }, 404)

    const { perTx, period, periodLengthDays = 7, expiryDays = 0 } =
      await bodyOf<{ perTx: string; period: string; periodLengthDays?: number; expiryDays?: number }>(c)
    const periodCap = parseUnits(String(period))

    // `grant` always mints a new id, so changing someone's limits has to
    // retire the old scope in the same operation. Leaving it live would mean
    // lowering a limit didn't lower anything — the old caps still stand — and
    // worse, the orphan keeps an empty allowlist, which the contract reads as
    // "any recipient". A household enforcing its book would be handing the
    // person it just re-granted a permission to pay anyone.
    const batch: Array<{ to: string; value: bigint; data: string }> = []
    if (member.scopeId && !member.revoked) {
      batch.push({ to: MANAGER, value: 0n, data: managerIface.encodeFunctionData('revoke', [member.scopeId]) })
    }

    batch.push(...buildGrantBatch({
      spender: member.address,
      perTxCap: parseUnits(String(perTx)),
      periodCap,
      periodLength: BigInt(Math.round(Number(periodLengthDays) * 86400)),
      expiry: expiryDays > 0 ? BigInt(Math.floor(Date.now() / 1000) + expiryDays * 86400) : 0n,
      newAllowanceTotal: outstandingCaps(family, periodCap, member.id),
    }))

    // A fresh scope starts with an empty allowlist, which the contract reads
    // as "any recipient". If this person is held to a list, it goes into the
    // same operation as the grant, so their scope is never briefly wider than
    // the interface says it is.
    if (member.allowOnly && member.allowed?.length) {
      const id = await predictScopeId(address, member.address)
      batch.push(...allowlistFor(member, id))
    }

    const { hash } = await account.sendTransaction(batch)
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
        perTx: String(perTx), period: String(period),
        periodLength: Math.round(Number(periodLengthDays) * 86400), expiry: 0,
      }
      m.grantTx = result.txHash
    })
    await record(family.id, {
      kind: 'allowance',
      text: `${member.name}'s limits set: ${perTx} a purchase, ${period} a week`,
      memberId: member.id, txHash: result.txHash,
    })
    return c.json({ scopeId, txHash: result.txHash, feeCharged: feeChargedFromLogs(result.logs) })
  }))

parentRoutes.post('/api/members/:id/revoke', (c) =>
  parentWrite(c, async (account, family) => {
    const member = family.members.find((m) => m.id === c.req.param('id'))
    if (!member?.scopeId) return c.json({ error: 'member has no allowance' }, 404)

    // Local only, so the recomputed allowance excludes them. Nothing is
    // written until the chain agrees.
    member.revoked = true
    const { hash } = await account.sendTransaction(buildRevokeBatch(member.scopeId, outstandingCaps(family)))
    const result = await waitForUserOp(account, hash)
    if (!result.success) return c.json({ error: 'Revoke failed. Try again.' }, 502)

    await updateFamily(family.id, (f) => {
      const m = f.members.find((x) => x.id === member.id)
      if (m) m.revoked = true
    })
    await record(family.id, { kind: 'revoke', text: `${member.name}'s spending turned off`, memberId: member.id, txHash: result.txHash })
    return c.json({ txHash: result.txHash, feeCharged: feeChargedFromLogs(result.logs) })
  }))

/**
 * The guardian paying someone straight out of the household position.
 *
 * No scope, no allowlist, no limit — they are the funder, and the money is
 * theirs. Aave enforces the only ceiling there is.
 */
parentRoutes.post('/api/pay', (c) =>
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
      kind: 'payment', text: `You paid ${amount} to ${recipientName(family, to)}`,
      amount: String(amount), txHash: result.txHash,
    })
    return c.json({ txHash: result.txHash, feeCharged: feeChargedFromLogs(result.logs) })
  }))

/**
 * The household address book.
 *
 * Names against addresses, and nothing more. Editing it never touches the
 * chain, because the book on its own permits nothing: an address only becomes
 * payable when it is on some *person's* allowlist. That separation is what
 * makes adding a shop free and instant while restricting a child is a real
 * on-chain write.
 */
parentRoutes.post('/api/recipients', async (c) => {
  const ctx = await parentOf(c)
  if (!ctx) return refuse(c)
  const { name, address, kind = 'PERSON' } =
    await bodyOf<{ name: string; address: string; kind?: 'SHOP' | 'PERSON' }>(c)

  if (!name?.trim()) return c.json({ error: 'Give them a name.' }, 400)
  if (!ethers.isAddress(address)) return c.json({ error: "That doesn't look like an address." }, 400)
  const canonical = ethers.getAddress(address)
  if (ctx.family.recipients.some((r) => r.address.toLowerCase() === canonical.toLowerCase())) {
    return c.json({ error: 'That address is already in the book.' }, 400)
  }

  const saved = await updateFamily(ctx.family.id, (f) => {
    f.recipients.push({
      id: randomId(), name: name.trim(), address: canonical,
      kind: kind === 'SHOP' ? 'SHOP' : 'PERSON',
    })
  })
  return c.json({ recipients: saved.recipients })
})

/**
 * Take an address out of the book.
 *
 * Anyone currently allowed to pay it loses that permission on-chain too,
 * otherwise the book would say one thing and the contract another. Each of
 * those is one write against one scope.
 */
parentRoutes.post('/api/recipients/:id/remove', async (c) => {
  const ctx = await parentOf(c)
  if (!ctx) return refuse(c)
  const gone = ctx.family.recipients.find((r) => r.id === c.req.param('id'))
  if (!gone) return c.json({ error: 'That one is not in the book.' }, 400)

  const holders = ctx.family.members.filter(
    (m) => m.scopeId && !m.revoked && m.allowOnly
      && m.allowed?.some((a) => a.toLowerCase() === gone.address.toLowerCase()),
  )

  if (holders.length === 0) {
    const saved = await updateFamily(ctx.family.id, (f) => {
      f.recipients = f.recipients.filter((r) => r.id !== gone.id)
    })
    return c.json({ recipients: saved.recipients, onchain: false })
  }

  return parentWrite(c, async (account, family) => {
    const txs = holders.flatMap((m) => buildAllowlistBatch([m.scopeId!], { deny: [gone.address] }))
    const { hash } = await account.sendTransaction(txs)
    const result = await waitForUserOp(account, hash)
    if (!result.success) return c.json({ error: 'Removing it on-chain failed. Nothing changed.' }, 502)

    const saved = await updateFamily(family.id, (f) => {
      f.recipients = f.recipients.filter((r) => r.id !== gone.id)
      for (const m of f.members) {
        m.allowed = (m.allowed ?? []).filter((a) => a.toLowerCase() !== gone.address.toLowerCase())
      }
    })
    await record(family.id, {
      kind: 'allowance',
      text: `${gone.name} removed from the address book`,
      txHash: result.txHash,
    })
    return c.json({
      recipients: saved.recipients, onchain: true,
      txHash: result.txHash, feeCharged: feeChargedFromLogs(result.logs),
    })
  })
})

/**
 * Where one person may pay.
 *
 * This is the operation the contract actually models:
 * `allowlist[scopeId][address]`, one list per scope, and a scope belongs to
 * one member. Turning it off empties their list, because an empty allowlist
 * is already how the contract spells "anyone".
 *
 * Only the difference is written. Re-sending the whole list would work but
 * costs gas per address for addresses that were already set, and — more to
 * the point — would not *un*-permit anything, since `setAllowlist` only
 * writes the value it is handed.
 */
parentRoutes.post('/api/members/:id/allowlist', (c) =>
  parentWrite(c, async (account, family) => {
    const member = family.members.find((m) => m.id === c.req.param('id'))
    if (!member) return c.json({ error: 'unknown member' }, 404)
    if (!member.scopeId || member.revoked) {
      return c.json({ error: 'Give them a limit first, then choose where it can go.' }, 409)
    }

    const { only, allowed = [] } = await bodyOf<{ only: boolean; allowed?: string[] }>(c)
    const on = Boolean(only)

    const known = new Map(family.recipients.map((r) => [r.address.toLowerCase(), r.address]))
    const next = on
      ? [...new Set(allowed.map((a) => known.get(a.toLowerCase())).filter(Boolean) as string[])]
      : []
    const before = member.allowOnly ? (member.allowed ?? []) : []

    const lower = (xs: string[]) => new Set(xs.map((x) => x.toLowerCase()))
    const had = lower(before)
    const has = lower(next)
    const add = next.filter((a) => !had.has(a.toLowerCase()))
    const drop = before.filter((a) => !has.has(a.toLowerCase()))

    if (add.length === 0 && drop.length === 0 && on === Boolean(member.allowOnly)) {
      return c.json({ onchain: false })
    }

    const txs = buildAllowlistBatch([member.scopeId], { allow: add, deny: drop })
    if (txs.length === 0) {
      const saved = await updateFamily(family.id, (f) => {
        const m = f.members.find((x) => x.id === member.id)
        if (m) { m.allowOnly = on; m.allowed = next }
      })
      return c.json({ onchain: false, members: saved.members.length })
    }

    const { hash } = await account.sendTransaction(txs)
    const result = await waitForUserOp(account, hash)
    if (!result.success) return c.json({ error: 'Setting the list on-chain failed. Nothing changed.' }, 502)

    await updateFamily(family.id, (f) => {
      const m = f.members.find((x) => x.id === member.id)
      if (m) { m.allowOnly = on; m.allowed = next }
    })
    await record(family.id, {
      kind: 'allowance',
      memberId: member.id,
      text: on
        ? `${member.name} can pay ${next.length} ${next.length === 1 ? 'place' : 'places'}`
        : `${member.name} can pay anyone again`,
      txHash: result.txHash,
    })
    return c.json({ onchain: true, txHash: result.txHash, feeCharged: feeChargedFromLogs(result.logs) })
  }))

function recipientName(family: Family, address: string): string {
  return family.recipients.find((r) => r.address.toLowerCase() === address.toLowerCase())?.name
    ?? `${address.slice(0, 6)}…${address.slice(-4)}`
}

function randomId(): string {
  return 'r' + Math.random().toString(36).slice(2, 10)
}

/** Asks carry a 24h on-chain TTL — the same one `requestSpend` was given. */
const REQUEST_TTL_MS = 24 * 3600 * 1000

function hasExpired(req: { createdAt: number }): boolean {
  return Date.now() - req.createdAt > REQUEST_TTL_MS
}

/**
 * Approving an ask needs head-room beyond the standing allowance.
 *
 * Raise it by exactly the request, settle, and put it back — one atomic
 * operation, so the allowance is never unbounded and never left inflated.
 */
function settleApproveBatch(family: Family, requestId: string, amount: bigint): Tx[] {
  return [
    { to: AAVE.A_ASSET, value: 0n, data: erc20.encodeFunctionData('approve', [MANAGER, outstandingCaps(family, amount)]) },
    { to: MANAGER, value: 0n, data: managerIface.encodeFunctionData('approveRequest', [requestId]) },
    { to: AAVE.A_ASSET, value: 0n, data: erc20.encodeFunctionData('approve', [MANAGER, outstandingCaps(family)]) },
  ]
}

parentRoutes.post('/api/requests/:requestId/:verdict', (c) =>
  parentWrite(c, async (account, family) => {
    const req = family.requests.find((r) => r.requestId === c.req.param('requestId'))
    if (!req || req.status !== 'pending') return c.json({ error: 'request is not pending' }, 404)
    const verdict = c.req.param('verdict')
    if (verdict !== 'approve' && verdict !== 'deny') return c.json({ error: 'unknown verdict' }, 400)

    // Approving a lapsed ask reverts on-chain and can never succeed. Retire it
    // instead of offering a retry that will fail identically. Denying still
    // works — denyRequest doesn't check expiry — so it stays available.
    if (verdict === 'approve' && hasExpired(req)) {
      await updateFamily(family.id, (f) => {
        const r = f.requests.find((x) => x.requestId === req.requestId)
        if (r) r.status = 'expired'
      })
      return c.json({ error: 'That ask is more than a day old and has lapsed. Ask them to try again.' }, 409)
    }

    const txs = verdict === 'approve'
      ? settleApproveBatch(family, req.requestId, parseUnits(req.amount))
      : [{ to: MANAGER, value: 0n, data: managerIface.encodeFunctionData('denyRequest', [req.requestId]) }]

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
  const ctx = await parentOf(c)
  if (!ctx) return refuse(c)
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
  const withdraw = poolIface.getFunction('withdraw')!.selector
  const allowlist = managerIface.getFunction('setAllowlist')!.selector
  const revoke = managerIface.getFunction('revoke')!.selector
  const approveReq = managerIface.getFunction('approveRequest')!.selector
  const denyReq = managerIface.getFunction('denyRequest')!.selector
  const steps = txs.flatMap((tx) => {
    const to = tx.to.toLowerCase()
    const sel = tx.data.slice(0, 10)
    if (sel === approve) return []
    if (to === AAVE.FAUCET.toLowerCase()) return [`Get test ${AAVE.SYMBOL}`]
    if (to === AAVE.POOL.toLowerCase()) return sel === withdraw ? ['Take it out of Aave'] : ['Move it into Aave']
    if (to === MANAGER.toLowerCase()) {
      if (sel === allowlist) return ['Write the list on-chain']
      if (sel === revoke) return ['Cancel the permission on-chain']
      if (sel === approveReq) return ['Let the payment through']
      if (sel === denyReq) return ['Turn down the ask on-chain']
      return ['Write the limit on-chain']
    }
    return [`Call ${tx.to.slice(0, 10)}…`]
  })
  // N scopes take the same edit; describing it N times says nothing extra.
  return steps.filter((s, i) => s !== steps[i - 1])
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
      // Mirror the real batch exactly: retire the old scope, grant the new
      // one, and carry the book onto it if the household enforces one.
      const txs: Array<{ to: string; value: bigint; data: string }> = []
      if (member.scopeId && !member.revoked) {
        txs.push({ to: MANAGER, value: 0n, data: managerIface.encodeFunctionData('revoke', [member.scopeId]) })
      }
      txs.push(...buildGrantBatch({
        spender: member.address,
        perTxCap: parseUnits(String(body.perTx ?? '0')),
        periodCap,
        periodLength: BigInt(Math.round(Number(body.periodLengthDays ?? 7) * 86400)),
        expiry: 0n,
        newAllowanceTotal: outstandingCaps(family, periodCap, member.id),
      }))
      if (member.allowOnly && member.allowed?.length) {
        txs.push(...allowlistFor(member, await predictScopeId(address, member.address)))
      }
      return txs
    }
    case 'revoke': {
      const member = family.members.find((m) => m.id === body.memberId)
      if (!member?.scopeId) throw new Error('member has no allowance')
      return buildRevokeBatch(member.scopeId, outstandingCaps(family, 0n, member.id))
    }
    case 'pay': {
      const plan = await planGuardianPay(address, String(body.to ?? ''), parseUnits(String(body.amount ?? '0')))
      if (!plan.ok) throw new Error(plan.reason)
      return plan.txs
    }
    // Settling an ask raises the standing allowance by exactly the request,
    // approves it, and puts the allowance back — three calls, and until now
    // the only guardian action with no quote behind it.
    case 'settle': {
      const req = family.requests.find((r) => r.requestId === body.requestId)
      if (!req || req.status !== 'pending') throw new Error('That ask is no longer waiting.')
      return body.verdict === 'deny'
        ? [{ to: MANAGER, value: 0n, data: managerIface.encodeFunctionData('denyRequest', [req.requestId]) }]
        : settleApproveBatch(family, req.requestId, parseUnits(req.amount))
    }
    // One person's list. Priced on the difference, which is what will
    // actually be sent.
    case 'allowlist': {
      const member = family.members.find((m) => m.id === body.memberId)
      if (!member?.scopeId || member.revoked) return null
      const on = Boolean(body.only)
      const known = new Map(family.recipients.map((r) => [r.address.toLowerCase(), r.address]))
      const next = on
        ? [...new Set((body.allowed as string[] ?? []).map((a) => known.get(a.toLowerCase())).filter(Boolean) as string[])]
        : []
      const before = member.allowOnly ? (member.allowed ?? []) : []
      const has = new Set(next.map((x) => x.toLowerCase()))
      const had = new Set(before.map((x) => x.toLowerCase()))
      return buildAllowlistBatch([member.scopeId], {
        allow: next.filter((a) => !had.has(a.toLowerCase())),
        deny: before.filter((a) => !has.has(a.toLowerCase())),
      })
    }
    default:
      return null
  }
}

parentRoutes.get('/api/state', async (c) => {
  const ctx = await parentOf(c)
  if (!ctx) return refuse(c)
  const { s, family } = ctx

  const [pool, loose, addable, paysInUsdt, apr] = await Promise.all([
    aAssetRead.balanceOf(s.address) as Promise<bigint>,
    assetRead.balanceOf(s.address) as Promise<bigint>,
    depositableAmount(s.address),
    canPayFeesInUsdt(s.address),
    supplyApr(),
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
      spent = formatUnits(spentInCurrentPeriod(scope, resets))
      resetsAt = Number(resets)
    }
    return {
      id: m.id, name: m.name, address: m.address, scopeId: m.scopeId ?? null,
      caps: m.caps ?? null, revoked: Boolean(m.revoked), spendable, spentThisPeriod: spent, resetsAt,
      // Where this one may pay. Per person, as the contract stores it.
      allowOnly: Boolean(m.allowOnly), allowed: m.allowed ?? [],
    }
  }))

  return c.json({
    familyName: family.name,
    symbol: AAVE.SYMBOL,
    // Who is signed in, for the account corner.
    you: { name: family.parent?.name ?? 'You', address: s.address },
    wallet: {
      address: s.address,
      pot: formatUnits(pool),
      loose: formatUnits(loose),
      // What "Add money" may actually offer: the loose balance minus the fee
      // headroom this account needs to keep paying its own way.
      addable: formatUnits(addable),
      vault: AAVE.A_ASSET,
      asset: AAVE.ASSET,
      feeMode: paysInUsdt ? 'usdt' : 'sponsored',
      paymaster: USDT_PAYMASTER || null,
      setup: bootstrapStatus(s.address),
    },
    activity: family.activity,
    members,
    // A lapsed ask is not waiting for anyone: the contract would refuse it.
    pendingRequests: family.requests.filter((r) => r.status === 'pending' && !hasExpired(r)).map((r) => ({
      ...r, memberName: family.members.find((m) => m.id === r.memberId)?.name ?? '?',
    })),
    recipients: family.recipients,
  })
})
