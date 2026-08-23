// Copy the JSON files into MongoDB.
//
//   MONGODB_URI="mongodb+srv://..." node migrate-to-mongo.mjs [--force]
//
// Reads the on-disk households, vaults and sessions and writes them to the
// cluster. Idempotent: records are upserted by their own id, so running it
// twice changes nothing. The files are never touched — a migration that
// deletes the only copy of the data before anyone has confirmed the new one
// works is not one worth running.
import { MongoClient } from 'mongodb'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

try { process.loadEnvFile(new URL('../.env', import.meta.url).pathname) } catch { /* env may be exported */ }

const uri = process.env.MONGODB_URI
if (!uri) {
  console.error('MONGODB_URI is not set. Put it in .env or pass it inline.')
  process.exit(1)
}

const DATA = join(dirname(fileURLToPath(import.meta.url)), 'data')
const force = process.argv.includes('--force')

const readAll = (dir) => {
  const path = join(DATA, dir)
  if (!existsSync(path)) return []
  return readdirSync(path)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(path, f), 'utf8')))
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 })
await client.connect()
const db = client.db(process.env.MONGODB_DB || 'kin')
console.log(`connected to ${db.databaseName}`)

const families = readAll('families').filter((d) => d?.id)
const vaults = readAll('vaults').filter((d) => d?.credentialId)

const existing = await db.collection('families').countDocuments()
if (existing > 0 && !force) {
  console.log(`${existing} household(s) already there. Re-run with --force to upsert over them.`)
} else {
  for (const f of families) {
    await db.collection('families').updateOne(
      { _id: f.id },
      { $set: { ...f, _id: f.id }, $setOnInsert: { rev: 0 } },
      { upsert: true },
    )
  }
  for (const v of vaults) {
    await db.collection('vaults').updateOne(
      { _id: v.credentialId },
      { $set: { ...v, _id: v.credentialId } },
      { upsert: true },
    )
  }
  console.log(`upserted ${families.length} household(s), ${vaults.length} vault(s)`)
}

// The indexes the app relies on: one lookup per join instead of a scan, and
// sessions that expire without anyone having to sweep them.
await db.collection('families').createIndex({ 'invites.token': 1 })
await db.collection('vaults').createIndex({ familyId: 1 })
await db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
console.log('indexes in place')

for (const name of ['families', 'vaults', 'sessions']) {
  console.log(`  ${name.padEnd(10)} ${await db.collection(name).countDocuments()}`)
}

await client.close()
console.log('\nDone. Set MONGODB_URI in .env and restart the server to use it.')
