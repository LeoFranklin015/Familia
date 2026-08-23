export class ApiError extends Error {
  status: number
  /** The server no longer knows this session. Not a failure of the action —
   *  the action never started, and no amount of retrying will help. */
  sessionEnded: boolean
  constructor(message: string, status: number, sessionEnded = false) {
    super(message)
    this.status = status
    this.sessionEnded = sessionEnded
  }
}

/**
 * Called when any request reports the session is gone, so the app can return
 * to sign-in instead of showing a payment as refused.
 */
let onSessionEnd: (() => void) | null = null
export function whenSessionEnds(fn: () => void) { onSessionEnd = fn }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    ...init,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const ended = Boolean(body.sessionEnded)
    if (ended) onSessionEnd?.()
    throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status, ended)
  }
  return body as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
}

export type Whoami = {
  role: 'parent' | 'member' | null
  address?: string
  credentialId?: string
  familyName?: string | null
}

/** Somewhere the household can pay. A name against an address — free to
 *  keep, and a rule the contract enforces once `allowOnly` is on. */
export type Recipient = {
  id: string
  name: string
  address: string
  kind: 'SHOP' | 'PERSON'
}

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
  /** The signed-in guardian. */
  you: { name: string; address: string }
  wallet: {
    address: string
    pot: string
    /** USD₮ sitting in the account, outside Aave: what deposits are funded
     *  from and what network fees are charged against. */
    loose: string
    /** How much of `loose` may actually be supplied — the rest is the fee
     *  headroom this account keeps to pay its own way. */
    addable: string
    /** Aave's supply rate, as a fraction per year. */
    apr: number
    /** When `pot` was read, so the interface can carry it forward. */
    potAt: number
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
    /** Whether this person is held to a list of places. Per person, because
     *  that is how the contract stores it. */
    allowOnly: boolean
    /** The addresses they may pay, when `allowOnly` is on. */
    allowed: string[]
  }>
  pendingRequests: Array<{
    requestId: string
    memberName: string
    toName: string
    amount: string
    createdAt: number
    /** They could not have paid this themselves: it is outside their places.
     *  Approving overrides that, so the card says so. */
    offList?: boolean
  }>
  /** The household address book. Names against addresses, and nothing more:
   *  an entry permits nothing until it is on someone's list. */
  recipients: Recipient[]
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

/**
 * What a member is allowed to know: their own name, whether they can pay,
 * their own limits, and their own history. Never the household balance, and
 * never anything about anyone else — enforced on the server, not by hiding UI.
 */
export type MemberState = {
  name: string
  familyName: string
  symbol: string
  hasAllowance: boolean
  /** Turned off by a guardian, as against never granted. Different screens. */
  revoked: boolean
  /** Their own per-purchase ceiling. */
  limit: string | null
  /** Their own weekly ceiling. */
  period: string | null
  /** What would clear right now. */
  headroom: string
  spentThisPeriod: string
  resetsAt: number
  /** The whole book, so an address in their history resolves to a name. */
  recipients: Recipient[]
  /** Their own restriction, and the places it permits. */
  allowOnly: boolean
  allowed: string[]
  myRequests: Array<{ requestId: string; toName: string; amount: string; status: string; createdAt: number }>
  activity: Activity[]
}
