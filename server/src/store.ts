// Persistence, split along the line that matters: family records are ordinary
// application data, key material is not.
//
//   data/families/<familyId>.json   who is in the household, limits, history
//   data/vaults/<credentialId>.json encrypted entropy, one file per account
//
// Vault files are written 0600 and hold only ciphertext, a public salt, and
// the routing needed to identify their owner. Nothing in them opens without
// the key the passkey re-derives, and nothing outside them can produce it.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, chmodSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DATA = join(dirname(fileURLToPath(import.meta.url)), '../data')
const FAMILIES = join(DATA, 'families')
const VAULTS = join(DATA, 'vaults')

mkdirSync(FAMILIES, { recursive: true })
mkdirSync(VAULTS, { recursive: true, mode: 0o700 })
try { chmodSync(VAULTS, 0o700) } catch { /* best effort on exotic filesystems */ }

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
 * Somewhere the household can pay — a shop or a person.
 *
 * The book itself is ordinary application data: naming an address costs
 * nothing and is instant. What it means on-chain depends on `allowOnly`: when
 * that is on, exactly these addresses are written into every active scope's
 * allowlist, and the contract refuses anything else. The names never reach
 * the chain — only the addresses do.
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

/** Shops every household starts with, so the first payment has somewhere to
 *  go. Deterministic, obviously-test addresses. */
export const STARTER_RECIPIENTS: Recipient[] = [
  { id: 'r-corner', name: 'Corner Store', address: '0x1111000000000000000000000000000000001111', kind: 'SHOP' },
  { id: 'r-books', name: 'Book Shop', address: '0x2222000000000000000000000000000000002222', kind: 'SHOP' },
  { id: 'r-games', name: 'Game Pass', address: '0x3333000000000000000000000000000000003333', kind: 'SHOP' },
]

// --------------------------------------------------------------- families
const familyPath = (id: string) => join(FAMILIES, `${id}.json`)

function writeAtomic(path: string, data: unknown, mode?: number) {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), mode ? { mode } : undefined)
  renameSync(tmp, path)
  if (mode) { try { chmodSync(path, mode) } catch { /* best effort */ } }
}

export function createFamily(name: string, parentName: string): { family: Family; parentJoinToken: string } {
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
  saveFamily(family)
  return { family, parentJoinToken: token }
}

/** Fill in fields added after a household was written. Households outlive
 *  the schema, and a missing array should read as empty, not crash a route. */
function normalize(f: Family): Family {
  f.recipients ??= STARTER_RECIPIENTS.map((r) => ({ ...r }))
  f.allowOnly ??= false
  return f
}

export function getFamily(id: string): Family | null {
  const p = familyPath(id)
  return existsSync(p) ? normalize(JSON.parse(readFileSync(p, 'utf8')) as Family) : null
}

export function mustFamily(id: string): Family {
  const f = getFamily(id)
  if (!f) throw new Error('That family no longer exists.')
  return f
}

export function saveFamily(f: Family) {
  writeAtomic(familyPath(f.id), f)
}

export function listFamilies(): Family[] {
  if (!existsSync(FAMILIES)) return []
  return readdirSync(FAMILIES)
    .filter((n) => n.endsWith('.json'))
    .map((n) => normalize(JSON.parse(readFileSync(join(FAMILIES, n), 'utf8')) as Family))
}

/** Find the family holding an unused invite token, across all of them. */
export function findInvite(token: string): { family: Family; invite: Family['invites'][number] } | null {
  for (const family of listFamilies()) {
    const invite = family.invites.find((i) => i.token === token && !i.usedBy)
    if (invite) return { family, invite }
  }
  return null
}

export function newInvite(family: Family, name: string): string {
  const token = randomBytes(16).toString('hex')
  family.invites.push({ token, name, createdAt: Date.now() })
  saveFamily(family)
  return token
}

export function record(familyId: string, entry: Omit<Activity, 'id' | 'at'>) {
  const f = mustFamily(familyId)
  f.activity.unshift({ ...entry, id: randomBytes(8).toString('hex'), at: Date.now() })
  f.activity = f.activity.slice(0, 100)
  saveFamily(f)
}

// ----------------------------------------------------------------- vaults
/** Credential ids are chosen by the authenticator (base64url) or by us for
 *  passphrase accounts. Keep them to a safe filename alphabet either way. */
const safeId = (id: string) => /^[A-Za-z0-9_:-]{1,128}$/.test(id)
const vaultPath = (credentialId: string) => join(VAULTS, `${encodeURIComponent(credentialId)}.json`)

export function putVault(v: Vault) {
  if (!safeId(v.credentialId)) throw new Error('Unusable credential id.')
  writeAtomic(vaultPath(v.credentialId), v, 0o600)
}

export function getVault(credentialId: string): Vault | null {
  if (!safeId(credentialId)) return null
  const p = vaultPath(credentialId)
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Vault) : null
}
