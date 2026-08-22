// WebAuthn + the PRF extension. The PRF output is the vault master key: 32
// bytes re-derived from the passkey at every unlock, never stored anywhere.
// If the authenticator doesn't support PRF we fall back to a passphrase —
// same downstream vault code, different key source.

const PRF_SALT = new TextEncoder().encode('kin-vault-v1-prf-salt-32bytes!!!') // fixed app-scoped salt

const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n))

export type PasskeyResult = { credentialId: string; prfKeyHex: string }

export function webauthnAvailable(): boolean {
  return typeof PublicKeyCredential !== 'undefined'
}

/** Create a passkey and evaluate PRF. Returns null if PRF is unsupported —
 *  caller falls back to the passphrase path. */
export async function createPasskey(userName: string): Promise<PasskeyResult | null> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: rand(32),
      rp: { name: 'Kin' },
      user: { id: rand(16), name: userName, displayName: userName },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      extensions: { prf: { eval: { first: PRF_SALT } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null
  if (!cred) return null

  const ext = cred.getClientExtensionResults() as { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } }
  // Some authenticators return PRF output at create time; most need a get().
  if (ext.prf?.results?.first) {
    return { credentialId: b64url(cred.rawId), prfKeyHex: hex(ext.prf.results.first) }
  }
  if (ext.prf?.enabled === false) return null
  const got = await getPrf(cred.rawId)
  return got ? { credentialId: b64url(cred.rawId), prfKeyHex: got } : null
}

/** Sign in with an existing (discoverable) passkey and evaluate PRF. */
export async function unlockPasskey(): Promise<PasskeyResult | null> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: rand(32),
      userVerification: 'required',
      extensions: { prf: { eval: { first: PRF_SALT } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null
  if (!cred) return null
  const ext = cred.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } }
  if (!ext.prf?.results?.first) return null
  return { credentialId: b64url(cred.rawId), prfKeyHex: hex(ext.prf.results.first) }
}

async function getPrf(rawId: ArrayBuffer): Promise<string | null> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: rand(32),
      allowCredentials: [{ type: 'public-key', id: rawId }],
      userVerification: 'required',
      extensions: { prf: { eval: { first: PRF_SALT } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null
  if (!cred) return null
  const ext = cred.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } }
  return ext.prf?.results?.first ? hex(ext.prf.results.first) : null
}
