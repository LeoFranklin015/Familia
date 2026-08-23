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

/**
 * Prompt the platform authenticator and return the key material for one call.
 *
 * Scoped to the credential this browser already signed in with, so the prompt
 * is Face ID rather than an account picker. Every write goes through here, so
 * one saved tap is a lot of saved taps.
 */
export async function approve(): Promise<Approval> {
  const pk = await unlockPasskey(knownCredentialId())
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

/**
 * Why an approval didn't happen, in words.
 *
 * The authenticator throws for several reasons that all mean "not signed":
 * the person dismissed the sheet, it timed out, or a second prompt cancelled
 * the first. None of them are failures of the payment, so none should read
 * like one.
 */
export function approvalProblem(e: unknown): string {
  const name = (e as { name?: string })?.name
  if (name === 'NotAllowedError') return 'That was cancelled, or it timed out. Try again when you\u2019re ready.'
  if (name === 'InvalidStateError') return 'This device already has a different account. Use its passphrase instead.'
  return 'This device could not confirm it was you. Try again, or use a passphrase.'
}
