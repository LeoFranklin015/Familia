// MongoDB storage.
//
// Chosen for hosting: a managed cluster survives a redeploy, which a file on
// an ephemeral filesystem does not. Three collections, each keyed by the id
// the application already uses, so nothing needs an extra lookup.
//
// On what this does and does not protect: vault entropy is encrypted before
// it reaches this file, with a key derived from the passkey and never stored
// anywhere, so the ciphertext here is useless without the person. Everything
// that matters about that is upstream. What the database is responsible for
// is not losing writes and not handing out stale reads.
import { MongoClient, type Collection, type Db } from 'mongodb'
import { normalize, type Family, type Session, type Vault } from '../store.js'
import { Contended, type Backend } from './backend.js'

/** How many times an update will re-read and re-apply before giving up. */
const RETRIES = 12

type FamilyDoc = Family & { _id: string; rev: number }
type VaultDoc = Vault & { _id: string }
type SessionDoc = Session & { _id: string }

export function mongoBackend(uri: string, dbName: string): Backend {
  const client = new MongoClient(uri, {
    // A demo that hangs for thirty seconds on a bad URI is worse than one
    // that says so.
    serverSelectionTimeoutMS: 8000,
    retryWrites: true,
  })
  let db: Db
  let families: Collection<FamilyDoc>
  let vaults: Collection<VaultDoc>
  let sessions: Collection<SessionDoc>
  let opened: Promise<void> | null = null

  const strip = <T extends { _id?: unknown; rev?: unknown }>(d: T | null) => {
    if (!d) return null
    const { _id, rev, ...rest } = d
    void _id; void rev
    return rest
  }

  async function open() {
    await client.connect()
    db = client.db(dbName)
    families = db.collection<FamilyDoc>('families')
    vaults = db.collection<VaultDoc>('vaults')
    sessions = db.collection<SessionDoc>('sessions')

    await Promise.all([
      // One indexed lookup per join, instead of scanning every household.
      families.createIndex({ 'invites.token': 1 }),
      vaults.createIndex({ familyId: 1 }),
      // Mongo evicts expired sessions itself, so nothing has to remember to.
      sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ])
  }

  return {
    ready() { opened ??= open(); return opened },
    describe() { return `mongodb/${dbName}` },

    async getFamily(id) {
      const doc = await families.findOne({ _id: id })
      return doc ? normalize(strip(doc) as Family) : null
    },

    async putFamily(family) {
      await families.updateOne(
        { _id: family.id },
        { $set: { ...family, _id: family.id }, $inc: { rev: 1 } },
        { upsert: true },
      )
    },

    /**
     * Read, apply, write — and only if nobody else wrote in between.
     *
     * `rev` is the guard: the update only matches the document it was read
     * from, so a lost race fails the match rather than overwriting. Then it
     * re-reads and applies again on the newer document, which is why `mutate`
     * has to be safe to run twice.
     */
    async updateFamily(id, mutate) {
      for (let attempt = 0; attempt < RETRIES; attempt += 1) {
        const doc = await families.findOne({ _id: id })
        if (!doc) throw new Error('That household no longer exists.')
        const rev = doc.rev ?? 0
        const family = normalize(strip(doc) as Family)
        mutate(family)
        const res = await families.updateOne(
          { _id: id, rev },
          { $set: { ...family, _id: id, rev: rev + 1 } },
        )
        if (res.matchedCount === 1) return family
        // Someone else wrote first. Backing off with jitter matters: retrying
        // immediately means the same set of writers collide again on the very
        // next tick.
        const wait = Math.min(2 ** attempt, 40) + Math.random() * 25
        await new Promise((r) => { setTimeout(r, wait) })
      }
      throw new Contended()
    },

    /**
     * One atomic operator, so concurrent writers never fight over it.
     *
     * `$position: 0` puts the newest first and `$slice: 100` trims the tail in
     * the same operation, which is exactly what the read-modify-write version
     * was doing by hand and losing races over.
     */
    async appendActivity(familyId, entry) {
      await families.updateOne(
        { _id: familyId },
        {
          $push: { activity: { $each: [entry], $position: 0, $slice: 100 } },
          $inc: { rev: 1 },
        },
      )
    },

    async listFamilies() {
      const docs = await families.find({}).toArray()
      return docs.map((d) => normalize(strip(d) as Family))
    },

    async findInviteFamilyId(token) {
      const doc = await families.findOne(
        { 'invites.token': token },
        { projection: { _id: 1 } },
      )
      return doc?._id ?? null
    },

    async getVault(credentialId) {
      return strip(await vaults.findOne({ _id: credentialId })) as Vault | null
    },

    async getVaultByAddress(address) {
      return strip(await vaults.findOne({
        address: { $regex: `^${address.replace(/[^0-9a-fA-Fx]/g, '')}$`, $options: 'i' },
      })) as Vault | null
    },

    async putVault(vault) {
      await vaults.updateOne(
        { _id: vault.credentialId },
        { $set: { ...vault, _id: vault.credentialId } },
        { upsert: true },
      )
    },

    async getSession(id) {
      return strip(await sessions.findOne({ _id: id })) as Session | null
    },

    async putSession(session) {
      await sessions.updateOne(
        { _id: session.id },
        { $set: { ...session, _id: session.id } },
        { upsert: true },
      )
    },

    /** No upsert, deliberately: see the interface. */
    async touchSession(id, expiresAt) {
      await sessions.updateOne({ _id: id }, { $set: { expiresAt } })
    },

    async deleteSession(id) {
      await sessions.deleteOne({ _id: id })
    },

    async sweepSessions(now) {
      // The TTL index does this on its own schedule; this is for the boundary
      // where a session is expired but Mongo has not swept it yet.
      await sessions.deleteMany({ expiresAt: { $lt: now } })
    },
  }
}
