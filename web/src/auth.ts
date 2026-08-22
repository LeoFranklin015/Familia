import { api } from './api'
import { unlockPasskey } from './webauthn'

/**
 * Approval for one action.
 *
 * Every write asks for the key at the moment it happens, the way a phone asks
 * before any other payment. Nothing durable is held: the PRF output goes
 * straight into the request that needs it and is not kept afterwards.
 *
 * Accounts without a passkey fall back to a passphrase, which the caller
 * collects. It is deliberately not cached — the point of asking each time is
 * lost if the answer is remembered.
 */
export type Approval = { credentialId: string; prfKeyHex?: string; passphrase?: string }

export class NeedsPassphrase extends Error {
  constructor() { super('passphrase required') }
}

/** Prompt the platform authenticator and return the key material for one call. */
export async function approve(): Promise<Approval> {
  const pk = await unlockPasskey()
  if (!pk) throw new NeedsPassphrase()
  return { credentialId: pk.credentialId, prfKeyHex: pk.prfKeyHex }
}

/** The credential this browser last used, for the passphrase path. */
export function knownCredentialId(): string | null {
  return localStorage.getItem('kin_credentialId')
}

/**
 * Run a write with fresh approval attached. `getApproval` is supplied by the
 * screen so it can fall back to its own passphrase prompt.
 */
export async function authorized<T>(
  getApproval: () => Promise<Approval>,
  call: (auth: Approval) => Promise<T>,
): Promise<T> {
  return call(await getApproval())
}

export const post = <T>(path: string, body: Record<string, unknown>, auth: Approval) =>
  api.post<T>(path, { ...body, auth })
