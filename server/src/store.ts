// Single-family JSON store. Hackathon-grade on purpose: one file, atomic-ish
// writes, no concurrency story beyond node's single thread.
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

export type VaultBlob = { ciphertextHex: string; saltHex: string; credentialId: string; prf: boolean }

export type Member = {
  id: string
  name: string
  address: string
  vault: VaultBlob
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

/** One line of history. `memberId` is set when a member caused it, which is
 *  also how a member's own feed is filtered — a member is never shown the
 *  household's activity, only their own payments. */
export type Activity = {
  id: string
  kind: 'deposit' | 'allowance' | 'revoke' | 'payment' | 'ask' | 'approved' | 'denied'
  text: string
  amount?: string
  memberId?: string
  txHash?: string
  at: number
}

export type Family = {
  name: string
  parent?: { name: string; address: string; vault: VaultBlob }
  parentInviteToken?: string
  invites: Array<{ token: string; name: string; usedBy?: string; createdAt: number }>
  members: Member[]
  requests: SpendRequest[]
  deposits: Array<{ amount: string; txHash: string; at: number }>
  activity: Activity[]
}

export function record(entry: Omit<Activity, 'id' | 'at'>) {
  const f = mustFamily()
  f.activity.unshift({ ...entry, id: randomBytes(8).toString('hex'), at: Date.now() })
  f.activity = f.activity.slice(0, 100)
  save()
}

const PATH = new URL('../data/family.json', import.meta.url).pathname

let family: Family | null = null

export function getFamily(): Family | null {
  // Check the file first: deleting it is the documented demo reset, so a
  // cached copy must not outlive it.
  if (!existsSync(PATH)) {
    family = null
    return null
  }
  if (!family) family = JSON.parse(readFileSync(PATH, 'utf8')) as Family
  return family
}

export function createFamily(name: string, parentName: string): { family: Family; parentJoinToken: string } {
  const token = randomBytes(16).toString('hex')
  family = {
    name,
    parentInviteToken: token,
    invites: [{ token, name: parentName, createdAt: Date.now() }],
    members: [],
    requests: [],
    deposits: [],
    activity: [],
  }
  save()
  return { family, parentJoinToken: token }
}

export function save() {
  if (!family) return
  const tmp = PATH + '.tmp'
  writeFileSync(tmp, JSON.stringify(family, null, 2))
  renameSync(tmp, PATH)
}

export function newInvite(name: string): string {
  const f = mustFamily()
  const token = randomBytes(16).toString('hex')
  f.invites.push({ token, name, createdAt: Date.now() })
  save()
  return token
}

export function findInvite(token: string) {
  return mustFamily().invites.find((i) => i.token === token && !i.usedBy)
}

export function findByCredentialId(credentialId: string): { role: 'parent' | 'member'; member?: Member; vault: VaultBlob } | undefined {
  const f = mustFamily()
  if (f.parent?.vault.credentialId === credentialId) return { role: 'parent', vault: f.parent.vault }
  const m = f.members.find((x) => x.vault.credentialId === credentialId)
  return m ? { role: 'member', member: m, vault: m.vault } : undefined
}

export function mustFamily(): Family {
  const f = getFamily()
  if (!f) throw new Error('No family yet — create one first.')
  return f
}
