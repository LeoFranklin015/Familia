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
type Role = 'parent' | 'member'

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
  revoked?: boolean
  joinedAt: number
  /**
   * Where this person may pay.
   *
   * Per person, because that is how the contract stores it —
   * `allowlist[scopeId][address]`, one list per scope, and a scope belongs to
   * one member. A household-wide list threw that granularity away: the point
   * is that a nine-year-old can be held to the corner shop while a teenager
   * is not.
   *
   * `allowOnly` off means the contract accepts any recipient from them, which
   * is what an empty on-chain allowlist already means.
   */
  allowOnly?: boolean
  /** Addresses they may pay, when `allowOnly` is on. */
  allowed?: string[]
}

type SpendRequest = {
  requestId: string
  memberId: string
  to: string
  toName: string
  amount: string
  status: 'pending' | 'approved' | 'denied' | 'expired'
  createdAt: number
  txHash?: string
  /** The member could not have paid this one themselves: it is outside the
   *  places they are allowed. Approving it overrides that. */
  offList?: boolean
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

/**
 * A recurring mandate: one scope, granted to a biller instead of a person.
 *
 * The price is stored here because the caps on-chain are what it was when the
 * mandate was signed. A service raising its price cannot widen an existing
 * scope; it needs a new one, which the household has to agree to.
 */
export type Subscription = {
  id: string
  serviceId: string
  scopeId?: string
  /** Monthly price, fixed at the moment the mandate was granted. */
  price: string
  revoked?: boolean
  startedAt: number
  /** When the scope lapses on its own, in unix seconds. */
  endsAt: number
  charges: Array<{ at: number; amount: string; txHash: string }>
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
  activity: Activity[]
  /**
   * The household's address book: names against addresses, shared so nobody
   * types the same hex twice. Purely a convenience — it reaches the chain only
   * through a *person's* allowlist, never on its own.
   */
  recipients: Recipient[]
  /** Recurring mandates the household has signed. */
  subscriptions: Subscription[]
  /** @deprecated Household-wide enforcement, replaced by the per-member list.
   *  Read once at migration and then left alone. */
  allowOnly?: boolean
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
const STARTER_RECIPIENTS: Recipient[] = [
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
  f.activity ??= []
  f.recipients ??= STARTER_RECIPIENTS.map((r) => ({ ...r }))
  f.subscriptions ??= []

  // Households written while the list was household-wide: give every member
  // the list the household had, which is what they were actually being held
  // to. Done on read so no separate migration has to run.
  for (const m of f.members) {
    if (m.allowOnly === undefined) {
      m.allowOnly = Boolean(f.allowOnly)
      m.allowed = f.allowOnly ? f.recipients.map((r) => r.address) : []
    }
    m.allowed ??= []
  }
  return f
}

// ----------------------------------------------------------------- backend
// The env file is loaded here as well as in chain.ts. Both are idempotent,
// and without it the choice below depends on which module ESM happens to
// evaluate first — which is how this silently fell back to files with a
// perfectly good connection string sitting in .env.
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url).pathname)
} catch { /* fine when the vars are exported directly */ }

let backend: Backend | null = null

/** Chosen on first use, not at import: module evaluation order is not a good
 *  thing to make configuration depend on. */
function chosen(): Backend {
  if (!backend) {
    const uri = process.env.MONGODB_URI?.trim()
    backend = uri
      // The default database keeps the app's former name: changing it would
      // orphan every household already written. Set MONGODB_DB to override.
      ? mongoBackend(uri, process.env.MONGODB_DB?.trim() || 'kin')
      : fileBackend()
  }
  return backend
}

/** Called once at boot, so a bad connection string fails there and not
 *  halfway through someone's first payment. */
export async function openStore(): Promise<string> {
  const b = chosen()
  await b.ready()
  return b.describe()
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
    activity: [],
    recipients: STARTER_RECIPIENTS.map((r) => ({ ...r })),
    subscriptions: [],
    allowOnly: false,
  }
  await chosen().putFamily(family)
  return { family, parentJoinToken: token }
}

export const getFamily = (id: string) => chosen().getFamily(id)

export async function mustFamily(id: string): Promise<Family> {
  const f = await chosen().getFamily(id)
  if (!f) throw new Error('That family no longer exists.')
  return f
}


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
  chosen().updateFamily(id, mutate)

/** Find the household holding an unused invite token. */
export async function findInvite(
  token: string,
): Promise<{ family: Family; invite: Family['invites'][number] } | null> {
  const familyId = await chosen().findInviteFamilyId(token)
  if (!familyId) return null
  const family = await chosen().getFamily(familyId)
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
  await chosen().appendActivity(familyId, {
    ...entry, id: randomBytes(8).toString('hex'), at: Date.now(),
  })
}

// ----------------------------------------------------------------- vaults
export const putVault = (v: Vault) => chosen().putVault(v)
export const getVault = (credentialId: string) => chosen().getVault(credentialId)

// --------------------------------------------------------------- sessions
const SESSION_TTL_MS = 12 * 60 * 60 * 1000 // identity only; grants no spending

export async function createSession(v: Omit<Session, 'id' | 'expiresAt'>): Promise<Session> {
  const session: Session = {
    ...v,
    id: randomBytes(24).toString('hex'),
    expiresAt: Date.now() + SESSION_TTL_MS,
  }
  await chosen().putSession(session)
  return session
}

/** How stale an expiry has to be before a read bothers to slide it. Without
 *  this, every request on every poll writes to the database. */
const SLIDE_AFTER_MS = 5 * 60 * 1000

export async function getSession(id: string | undefined): Promise<Session | undefined> {
  if (!id) return undefined
  const s = await chosen().getSession(id)
  if (!s) return undefined
  if (Date.now() > s.expiresAt) { await chosen().deleteSession(id); return undefined }

  // Sliding expiry, written back so it survives a restart. Not awaited, since
  // a read should not wait on bookkeeping — which is exactly why it goes
  // through `touchSession`: an upsert landing after a sign-out would bring the
  // session back.
  const next = Date.now() + SESSION_TTL_MS
  if (next - s.expiresAt > SLIDE_AFTER_MS) {
    s.expiresAt = next
    void chosen().touchSession(id, next).catch(() => {})
  }
  return s
}

export const destroySession = (id: string) => chosen().deleteSession(id)

setInterval(() => { void chosen().sweepSessions(Date.now()).catch(() => {}) }, 60_000).unref()
