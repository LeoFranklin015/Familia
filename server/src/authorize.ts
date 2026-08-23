// Per-action authorisation.
//
// Reads are answered from the session. Writes are not: each one carries a key
// source obtained at that moment — the PRF output a passkey re-derives, or a
// passphrase — which is used to open the caller's vault, sign, and then thrown
// away. Nothing durable in this process can sign on the user's behalf.
import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { getSession, getVault, type Session, type Vault } from './store.js'
import { openVaultEntry, type KeySource } from './vault.js'
import { withAccount, type GaslessAccount } from './wdk.js'

export const COOKIE = 'kin_session'

export function currentSession(c: Context<any, any, any>): Promise<Session | undefined> {
  return getSession(getCookie(c, COOKIE))
}

export class AuthError extends Error {
  status: 401 | 403
  constructor(message: string, status: 401 | 403 = 401) {
    super(message)
    this.status = status
  }
}

/** The shape every write endpoint expects alongside its own fields. */
type AuthPayload = { auth?: KeySource & { credentialId?: string } }

/**
 * Open the caller's vault with the key they just presented, run one operation
 * as them, and dispose the account.
 *
 * The session is still consulted, but only to check that the presented
 * credential belongs to the account the session claims to be — presenting
 * somebody else's passkey must not let you act as them.
 */
export async function actAs<T>(
  c: Context<any, any, any>,
  opts: { role?: 'parent' | 'member'; payFeesInUsdt?: boolean },
  fn: (account: GaslessAccount, vault: Vault) => Promise<T>,
): Promise<T> {
  const session = await currentSession(c)
  if (!session) throw new AuthError('Your session has ended. Sign in again.')
  if (opts.role && session.role !== opts.role) throw new AuthError(`${opts.role} only`, 403)

  const body = (await c.req.json().catch(() => ({}))) as AuthPayload
  const auth = body.auth
  if (!auth || (!auth.prfKeyHex && !auth.passphrase)) {
    throw new AuthError('This needs your approval. Confirm with Face ID.')
  }

  const credentialId = auth.credentialId ?? session.credentialId
  if (credentialId !== session.credentialId) {
    throw new AuthError('That passkey belongs to a different account.', 403)
  }

  const vault = await getVault(credentialId)
  if (!vault) throw new AuthError('No account for that passkey.')
  if (vault.familyId !== session.familyId) throw new AuthError('Wrong family for that account.', 403)

  let mnemonic: string
  try {
    mnemonic = await openVaultEntry(vault, auth)
  } catch {
    throw new AuthError("That didn't unlock your account. Try again.")
  }

  return withAccount(mnemonic, { memberGuard: vault.role === 'member', payFeesInUsdt: opts.payFeesInUsdt }, (a) => fn(a, vault))
}

/**
 * Say no, in words that point somewhere.
 *
 * "parent only" is true and useless: the overwhelmingly common cause is a
 * session that has ended, and being told the wrong role when the real problem
 * is a stale cookie sends you looking in the wrong place. The `sessionEnded`
 * flag also lets the interface act — return to sign-in rather than report the
 * payment someone was halfway through as refused.
 */
export async function refuse(c: Context<any, any, any>, wrongAccount: string) {
  return (await currentSession(c))
    ? c.json({ error: wrongAccount }, 403)
    : c.json({ error: 'Your session has ended. Sign in again.', sessionEnded: true }, 401)
}

/** Read the request body once, minus the auth blob. */
export async function bodyOf<T = Record<string, unknown>>(c: Context<any, any, any>): Promise<T> {
  const { auth: _auth, ...rest } = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  return rest as T
}
