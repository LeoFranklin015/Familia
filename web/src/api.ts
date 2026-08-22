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

export type ParentState = {
  familyName: string
  symbol: string
  pool: string
  deposits: Array<{ amount: string; txHash: string; at: number }>
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

export type MemberState = {
  name: string
  familyName: string
  symbol: string
  hasAllowance: boolean
  caps: { perTx: string; period: string; periodLength: number; expiry: number } | null
  spendable: string
  spentThisPeriod: string
  resetsAt: number
  merchants: Merchant[]
  myRequests: Array<{ requestId: string; toName: string; amount: string; status: string; createdAt: number }>
}
