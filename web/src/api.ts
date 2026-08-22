export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    ...init,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status)
  return body as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
}

export type Whoami = { role: 'parent' | 'member' | null; address?: string }

export type Merchant = { name: string; address: string }

export type Activity = {
  id: string
  kind: 'deposit' | 'allowance' | 'revoke' | 'payment' | 'ask' | 'approved' | 'denied'
  text: string
  amount?: string
  txHash?: string
  at: number
}

export type ParentState = {
  familyName: string
  symbol: string
  wallet: {
    address: string
    pot: string
    vault: string
    asset: string
    /** USD₮ sitting in the account, outside Aave: what deposits are funded
     *  from and what network fees are charged against. */
    loose: string
    feeBalance: string
    feeMode: 'usdt' | 'sponsored'
    paymaster: string | null
    /** Onboarding funding: happens once, in the background, at sign-up. */
    setup: { status: 'idle' | 'running' | 'done' | 'failed'; txHash?: string; reason?: string }
  }
  activity: Activity[]
  members: Array<{
    id: string
    name: string
    address: string
    scopeId: string | null
    caps: { perTx: string; period: string; periodLength: number; expiry: number } | null
    revoked: boolean
    spendable: string
    spentThisPeriod: string
    resetsAt: number
  }>
  pendingRequests: Array<{
    requestId: string
    memberName: string
    toName: string
    amount: string
    createdAt: number
  }>
  merchants: Merchant[]
}

export type FeeQuote = {
  feeMode: 'usdt' | 'sponsored'
  /** USD₮, or null if the paymaster refused to quote. */
  fee: string | null
  symbol: string
  paidIn?: string
  /** Why this action can't proceed at all — not a quoting failure. */
  blocked?: string
  /** Every on-chain call this single operation will make, in order. */
  steps?: string[]
  error?: string
}

/** What a member is allowed to know: their own name, whether they can pay,
 *  their own per-purchase limit, and their own history. Never the pot. */
export type MemberState = {
  name: string
  familyName: string
  symbol: string
  hasAllowance: boolean
  limit: string | null
  headroom: string
  spentThisPeriod: string
  resetsAt: number
  merchants: Merchant[]
  myRequests: Array<{ requestId: string; toName: string; amount: string; status: string; createdAt: number }>
  activity: Activity[]
}
