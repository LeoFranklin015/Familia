import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createVaultEntry, openVaultEntry } from './vault.js'

test('PRF master-key mode round-trips the mnemonic', async () => {
  const prfKeyHex = randomBytes(32).toString('hex')
  const entry = await createVaultEntry({ prfKeyHex })
  assert.equal(entry.mnemonic.split(' ').length, 12)
  const reopened = await openVaultEntry(entry, { prfKeyHex })
  assert.equal(reopened, entry.mnemonic)
})

test('wrong PRF key fails to decrypt', async () => {
  const entry = await createVaultEntry({ prfKeyHex: randomBytes(32).toString('hex') })
  await assert.rejects(async () => openVaultEntry(entry, { prfKeyHex: randomBytes(32).toString('hex') }))
})

test('passphrase fallback round-trips the mnemonic', async () => {
  const entry = await createVaultEntry({ passphrase: 'correct horse battery' })
  const reopened = await openVaultEntry(entry, { passphrase: 'correct horse battery' })
  assert.equal(reopened, entry.mnemonic)
  await assert.rejects(async () => openVaultEntry(entry, { passphrase: 'wrong horse battery' }))
})

test('short passphrase is rejected', async () => {
  await assert.rejects(async () => createVaultEntry({ passphrase: 'short' }))
})
