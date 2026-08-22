// Passkey vault: WDK Secret Manager behind a two-function adapter.
//
// Key source is either the 32-byte WebAuthn PRF output (master-key mode — the
// PBKDF2 step is bypassed, the key IS the key) or a passphrase (PBKDF2-SHA256,
// 100k iterations, 16-byte salt — the Secret Manager's own fallback path).
// Only ciphertext + salt are ever stored; the key is re-derived on the client
// at every unlock. Note: generateAndEncrypt is async in the implementation
// even though the shipped .d.ts types it sync — always await it.
import secretManagerPkg from '@tetherto/wdk-secret-manager'

const { WdkSecretManager, wdkSaltGenerator } = secretManagerPkg as unknown as {
  WdkSecretManager: new (passKey: Buffer | string, salt: Buffer) => {
    generateAndEncrypt(payload?: Buffer | null, derivedKey?: Buffer | null): Promise<{ encryptedSeed: Buffer; encryptedEntropy: Buffer }>
    decrypt(payload: Buffer, derivedKey?: Buffer | null): Buffer
    entropyToMnemonic(entropy: Buffer): string
    dispose(): void
  }
  wdkSaltGenerator: { generate(): Buffer }
}

export type KeySource = { prfKeyHex?: string; passphrase?: string }

function keyOf(src: KeySource): { passKey: Buffer | string; derivedKey: Buffer | null } {
  if (src.prfKeyHex) {
    const key = Buffer.from(src.prfKeyHex.replace(/^0x/, ''), 'hex')
    if (key.length !== 32) throw new Error('PRF key must be 32 bytes')
    return { passKey: key, derivedKey: key }
  }
  if (src.passphrase && src.passphrase.length >= 8) {
    return { passKey: src.passphrase, derivedKey: null }
  }
  throw new Error('Provide a PRF key or a passphrase of at least 8 characters')
}

/** Generate fresh entropy, encrypt it at rest, and hand back the mnemonic
 *  (in-memory only) plus the storable ciphertext + salt. */
export async function createVaultEntry(src: KeySource): Promise<{ mnemonic: string; ciphertextHex: string; saltHex: string }> {
  const salt = wdkSaltGenerator.generate()
  const { passKey, derivedKey } = keyOf(src)
  const sm = new WdkSecretManager(passKey, salt)
  try {
    const { encryptedEntropy } = await sm.generateAndEncrypt(null, derivedKey)
    const entropy = sm.decrypt(encryptedEntropy, derivedKey)
    const mnemonic = sm.entropyToMnemonic(entropy)
    return { mnemonic, ciphertextHex: encryptedEntropy.toString('hex'), saltHex: salt.toString('hex') }
  } finally {
    sm.dispose()
  }
}

/** Re-derive the mnemonic from stored ciphertext with a fresh key. */
export async function openVaultEntry(stored: { ciphertextHex: string; saltHex: string }, src: KeySource): Promise<string> {
  const salt = Buffer.from(stored.saltHex, 'hex')
  const { passKey, derivedKey } = keyOf(src)
  const sm = new WdkSecretManager(passKey, salt)
  try {
    const entropy = sm.decrypt(Buffer.from(stored.ciphertextHex, 'hex'), derivedKey)
    return sm.entropyToMnemonic(entropy)
  } finally {
    sm.dispose()
  }
}
