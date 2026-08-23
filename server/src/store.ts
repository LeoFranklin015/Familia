// Persistence, split along the line that matters: household records are
// ordinary application data, key material is not.
//
// Two things live behind this. MongoDB when `MONGODB_URI` is set, which is
// what a hosted deployment wants — a managed cluster survives a redeploy and
// an ephemeral filesystem does not. JSON files otherwise, so the thing still
// runs on a laptop with no cluster to point at.
//
// Vaults hold only ciphertext. The key that opens one is derived from a
// passkey at the moment of each write and is never stored, here or anywhere,
// so moving to a database changes nothing about how safe the entropy is. What
// it changes is whether concurrent writes can lose each other, and whether
// finding an invite has to read every household in the system.
import { randomBytes, randomUUID } from 'node:crypto'
import type { Backend } from './store/backend.js'
import { fileBackend } from './store/files.js'
import { mongoBackend } from './store/mongo.js'

export { Contended } from './store/backend.js'

// ------------------------------------------------------------------- types
export type Role = 'parent' | 'member'

/** One account's key material, plus enough to know whose it is. */
export type Vault = {
  credentialId: string
  ciphertextHex: string
  saltHex: string
  prf: boolean
  familyId: string
  role: Role
  memberId?: string
  address: string
  name: string
}

export type Member = {
  id: string
  name: string
  address: string
  credentialId: string
  scopeId?: string
  caps?: { perTx: string; period: string; periodLength: number; expiry: number }
  grantTx?: string
  revoked?: boolean
  joinedAt: number
}

export type SpendRequest = {
  requestId: string
  memberId: string
  to: string
  toName: string
  amount: string
  status: 'pending' | 'approved' | 'denied' | 'expired'
  createdAt: number
  txHash?: string
}

export type Activity = {
  id: string
  kind: 'deposit' | 'allowance' | 'revoke' | 'payment' | 'ask' | 'approved' | 'denied'
  text: string
  amount?: string
  memberId?: string
  txHash?: string
  at: number
}

/**
 * Somewhere the household can pay: a shop or a person.
 *
 * The book itself is ordinary application data. What it means on-chain
 * depends on `allowOnly`: when that is on, exactly these addresses are written
 * into every active scope's allowlist and the contract refuses anything else.
 * The names never reach the chain, only the addresses do.
 */
export type Recipient = {
  id: string
  name: string
  address: string
  kind: 'SHOP' | 'PERSON'
}

export type Family = {
  id: string
  name: string
  createdAt: number
  parent?: { name: string; address: string; credentialId: string }
  parentInviteToken?: string
  invites: Array<{ token: string; name: string; usedBy?: string; createdAt: number }>
  members: Member[]
  requests: SpendRequest[]
  deposits: Array<{ amount: string; txHash: string; at: number }>
  activity: Activity[]
  /** Who the household can pay. */
  recipients: Recipient[]
  /** Whether the book is enforced on-chain, or merely a convenience. */
  allowOnly: boolean
}

/** Identity for twelve hours. Grants no ability to sign anything. */
export type Session = {
  id: string
  familyId: string
  role: Role
  memberId?: string
  credentialId: string
  address: string
  name: string
  expiresAt: number
}

/** Shops every household starts with, so the first payment has somewhere to
 *  go. Deterministic, obviously-test addresses. */
export const STARTER_RECIPIENTS: Recipient[] = [
  { id: 'r-corner', name: 'Corner Store', address: '0x1111000000000000000000000000000000001111', kind: 'SHOP' },
  { id: 'r-books', name: 'Book Shop', address: '0x2222000000000000000000000000000000002222', kind: 'SHOP' },
  { id: 'r-games', name: 'Game Pass', address: '0x3333000000000000000000000000000000003333', kind: 'SHOP' },
]

/** Fill in fields added after a household was written. Households outlive the
 *  schema, and a missing array should read as empty, not crash a route. */
export function normalize(f: Family): Family {
  f.invites ??= []
  f.members ??= []
  f.requests ??= []
  f.deposits ??= []
  f.activity ??= []
  f.recipients ??= STARTER_RECIPIENTS.map((r) => ({ ...r }))
  f.allowOnly ??= false
  return f
}

// ----------------------------------------------------------------- backend
const uri = process.env.MONGODB_URI

export const store: Backend = uri
  ? mongoBackend(uri, process.env.MONGODB_DB || 'kin')
  : fileBackend()

/** Called once at boot, so a bad connection string fails there and not
 *  halfway through someone's first payment. */
export async function openStore(): Promise<string> {
  await store.ready()
  return store.describe()
}

// -------------------------------------------------------------- households
export async function createFamily(
  name: string,
  parentName: string,
): Promise<{ family: Family; parentJoinToken: string }> {
  const token = randomBytes(16).toString('hex')
  const family: Family = {
    id: randomUUID(),
    name,
    createdAt: Date.now(),
    parentInviteToken: token,
    invites: [{ token, name: parentName, createdAt: Date.now() }],
    members: [],
    requests: [],
    deposits: [],
    activity: [],
    recipients: STARTER_RECIPIENTS.map((r) => ({ ...r })),
    allowOnly: false,
  }
  await store.putFamily(family)
  return { family, parentJoinToken: token }
}

export const getFamily = (id: string) => store.getFamily(id)

export async function mustFamily(id: string): Promise<Family> {
  const f = await store.getFamily(id)
  if (!f) throw new Error('That family no longer exists.')
  return f
}

export const saveFamily = (f: Family) => store.putFamily(f)
export const listFamilies = () => store.listFamilies()

/**
 * Apply a change to a household atomically.
 *
 * This is the reason for a database. Every write here reads a household, waits
 * fifteen to thirty seconds for the chain, and saves it afterwards; two of
 * those overlapping used to mean one was silently discarded — a child's ask
 * erased while the on-chain request lived on, so it could never be approved.
 * The mutation now runs against the household as it is at write time, and is
 * retried if someone else got there first.
 */
export const updateFamily = (id: string, mutate: (f: Family) => void) =>
  store.updateFamily(id, mutate)

/** Find the household holding an unused invite token. */
export async function findInvite(
  token: string,
): Promise<{ family: Family; invite: Family['invites'][number] } | null> {
  const familyId = await store.findInviteFamilyId(token)
  if (!familyId) return null
  const family = await store.getFamily(familyId)
  const invite = family?.invites.find((i) => i.token === token && !i.usedBy)
  return family && invite ? { family, invite } : null
}

export async function newInvite(family: Family, name: string): Promise<string> {
  const token = randomBytes(16).toString('hex')
  await updateFamily(family.id, (f) => {
    f.invites.push({ token, name, createdAt: Date.now() })
  })
  return token
}

export async function record(familyId: string, entry: Omit<Activity, 'id' | 'at'>): Promise<void> {
  await updateFamily(familyId, (f) => {
    f.activity.unshift({ ...entry, id: randomBytes(8).toString('hex'), at: Date.now() })
    f.activity = f.activity.slice(0, 100)
  })
}

// ----------------------------------------------------------------- vaults
export const putVault = (v: Vault) => store.putVault(v)
export const getVault = (credentialId: string) => store.getVault(credentialId)

// --------------------------------------------------------------- sessions
const SESSION_TTL_MS = 12 * 60 * 60 * 1000 // identity only; grants no spending

export async function createSession(v: Omit<Session, 'id' | 'expiresAt'>): Promise<Session> {
  const session: Session = {
    ...v,
    id: randomBytes(24).toString('hex'),
    expiresAt: Date.now() + SESSION_TTL_MS,
  }
  await store.putSession(session)
  return session
}

export async function getSession(id: string | undefined): Promise<Session | undefined> {
  if (!id) return undefined
  const s = await store.getSession(id)
  if (!s) return undefined
  if (Date.now() > s.expiresAt) { await store.deleteSession(id); return undefined }
  // Sliding expiry, written back so it survives a restart. Not awaited: a
  // read should not wait on bookkeeping.
  s.expiresAt = Date.now() + SESSION_TTL_MS
  void store.putSession(s).catch(() => {})
  return s
}

export const destroySession = (id: string) => store.deleteSession(id)

setInterval(() => { void store.sweepSessions(Date.now()).catch(() => {}) }, 60_000).unref()
