// JSON files on disk — what this used to be, kept for running without a
// cluster.
//
//   data/families/<familyId>.json    household data
//   data/vaults/<credentialId>.json  encrypted entropy, 0600, in a 0700 dir
//   data/sessions.json               identity only, no key material
//
// Writes go through a temp file and a rename, so a crash mid-write leaves the
// old record intact rather than half of a new one. `updateFamily` is atomic
// for the reason single-threaded JavaScript usually is: the read, the mutate
// and the write happen in one tick with nothing awaited between them.
import {
  chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalize, type Family, type Session, type Vault } from '../store.js'
import type { Backend } from './backend.js'

const DATA = join(dirname(fileURLToPath(import.meta.url)), '../../data')
const FAMILIES = join(DATA, 'families')
const VAULTS = join(DATA, 'vaults')
const SESSIONS = join(DATA, 'sessions.json')

function writeAtomic(path: string, data: unknown, mode?: number) {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), mode ? { mode } : undefined)
  renameSync(tmp, path)
  if (mode) { try { chmodSync(path, mode) } catch { /* best effort */ } }
}

const safeId = (id: string) => /^[A-Za-z0-9_:-]{1,128}$/.test(id)
const familyPath = (id: string) => join(FAMILIES, `${id}.json`)
const vaultPath = (id: string) => join(VAULTS, `${encodeURIComponent(id)}.json`)

const readJson = <T>(path: string): T | null =>
  existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null

export function fileBackend(): Backend {
  mkdirSync(FAMILIES, { recursive: true })
  mkdirSync(VAULTS, { recursive: true, mode: 0o700 })
  try { chmodSync(VAULTS, 0o700) } catch { /* exotic filesystems */ }

  const readSessions = (): Session[] => readJson<Session[]>(SESSIONS) ?? []
  const writeSessions = (all: Session[]) => writeAtomic(SESSIONS, all, 0o600)

  const get = (id: string) => {
    const doc = readJson<Family>(familyPath(id))
    return doc ? normalize(doc) : null
  }

  return {
    async ready() { /* nothing to open */ },
    describe() { return `files/${DATA}` },

    async getFamily(id) { return get(id) },

    async putFamily(family) { writeAtomic(familyPath(family.id), family) },

    async updateFamily(id, mutate) {
      const family = get(id)
      if (!family) throw new Error('That household no longer exists.')
      mutate(family)
      writeAtomic(familyPath(id), family)
      return family
    },

    async listFamilies() {
      if (!existsSync(FAMILIES)) return []
      return readdirSync(FAMILIES)
        .filter((n) => n.endsWith('.json'))
        .map((n) => normalize(JSON.parse(readFileSync(join(FAMILIES, n), 'utf8')) as Family))
    },

    async findInviteFamilyId(token) {
      for (const family of await this.listFamilies()) {
        if (family.invites.some((i) => i.token === token)) return family.id
      }
      return null
    },

    async getVault(credentialId) {
      if (!safeId(credentialId)) return null
      return readJson<Vault>(vaultPath(credentialId))
    },

    async putVault(vault) {
      if (!safeId(vault.credentialId)) throw new Error('Unusable credential id.')
      writeAtomic(vaultPath(vault.credentialId), vault, 0o600)
    },

    async getSession(id) { return readSessions().find((s) => s.id === id) ?? null },

    async putSession(session) {
      const all = readSessions().filter((s) => s.id !== session.id)
      all.push(session)
      writeSessions(all)
    },

    async deleteSession(id) { writeSessions(readSessions().filter((s) => s.id !== id)) },

    async sweepSessions(now) {
      const all = readSessions()
      const live = all.filter((s) => s.expiresAt > now)
      if (live.length !== all.length) writeSessions(live)
    },
  }
}
