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

/** base64url back to bytes, for naming a credential we already know. */
const fromB64url = (s: string): ArrayBuffer => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out.buffer as ArrayBuffer
}

type PasskeyResult = { credentialId: string; prfKeyHex: string }

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

/**
 * Unlock with an existing passkey and evaluate PRF.
 *
 * Naming the credential matters. Left open, the browser offers an account
 * picker every time — which is right when signing in, and wrong for the
 * hundredth approval of the evening: this app asks for a key before *every*
 * write, so a chooser between one option is pure friction. Given an id we
 * already hold, the platform goes straight to Face ID.
 *
 * If that id turns out to be unknown to this device — restored profile,
 * cleared authenticator, a vault moved between browsers — the scoped call
 * fails, and falling back to the open picker is better than a dead end.
 */
export async function unlockPasskey(credentialId?: string | null): Promise<PasskeyResult | null> {
  const attempt = async (id?: string | null) => {
    const cred = (await navigator.credentials.get({
      publicKey: {
        challenge: rand(32),
        ...(id ? { allowCredentials: [{ type: 'public-key' as const, id: fromB64url(id) }] } : {}),
        userVerification: 'required',
        extensions: { prf: { eval: { first: PRF_SALT } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null
    if (!cred) return null
    const ext = cred.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } }
    if (!ext.prf?.results?.first) return null
    return { credentialId: b64url(cred.rawId), prfKeyHex: hex(ext.prf.results.first) }
  }

  if (!credentialId) return attempt()
  try {
    return await attempt(credentialId)
  } catch (e) {
    // A cancelled prompt should stay cancelled; only an unusable id is worth
    // retrying, and that is what NotAllowedError covers here.
    if ((e as Error)?.name !== 'NotAllowedError') throw e
    return attempt()
  }
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
