import { unlockPasskey } from './webauthn'

/**
 * Approval for one action.
 *
 * Every write asks for the key at the moment it happens, the way a phone asks
 * before any other payment. Nothing durable is held: the PRF output goes
 * straight into the request that needs it and is not kept afterwards.
 *
 * Accounts without a passkey fall back to a passphrase, which the screen
 * collects. It is deliberately not cached — the point of asking each time is
 * lost if the answer is remembered.
 */
export type Approval = { credentialId: string; prfKeyHex?: string; passphrase?: string }

/** The authenticator has no PRF here. The caller should ask for a passphrase. */
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

/**
 * An account this browser has signed into before.
 *
 * Enough to show a person which one they are picking, and nothing more: no key
 * material, and nothing that is not already on a screen in the app.
 */
export type KnownAccount = {
  credentialId: string
  address: string
  name: string
  familyName: string
  /** Whether it signs in with a passkey or a passphrase. */
  prf: boolean
}

/**
 * The accounts this browser knows.
 *
 * A list rather than one, because a phone gets used by a household: a guardian
 * and a child can both have signed in here, and a shared browser should offer
 * the choice rather than silently keeping whoever went last.
 *
 * Most recent first, which is what the sign-in screen defaults to.
 */
const ACCOUNTS_KEY = 'kin_accounts'
const LEGACY_KEY = 'kin_credentialId'

export function knownAccounts(): KnownAccount[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY)
    if (raw) return JSON.parse(raw) as KnownAccount[]
  } catch { /* corrupt or unreadable: treat as none rather than crashing sign-in */ }

  // Written before this browser knew about a list. Keep the account so a
  // passphrase still has something to unlock, even without a name to show.
  const legacy = localStorage.getItem(LEGACY_KEY)
  return legacy
    ? [{ credentialId: legacy, address: '', name: 'Your account', familyName: '', prf: !legacy.startsWith('pass:') }]
    : []
}

/** The one to reach for by default, and what the passkey prompt is scoped to. */
export function knownCredentialId(): string | null {
  return knownAccounts()[0]?.credentialId ?? null
}

/** Remember an account, or move it to the front if it is already known. */
export function rememberAccount(account: KnownAccount): void {
  const rest = knownAccounts().filter((a) => a.credentialId !== account.credentialId)
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify([account, ...rest].slice(0, 8)))
    localStorage.removeItem(LEGACY_KEY)
  } catch { /* private mode, or a full quota: signing in still worked */ }
}

/** Take one off this browser. The account itself is untouched. */
export function forgetAccount(credentialId: string): void {
  const rest = knownAccounts().filter((a) => a.credentialId !== credentialId)
  try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(rest)) } catch { /* as above */ }
}

/**
 * Why an approval didn't happen, in words.
 *
 * The authenticator throws for several reasons that all mean "not signed": the
 * person dismissed the sheet, it timed out, or a second prompt cancelled the
 * first. None of them are failures of the payment, so none should read like
 * one.
 */
export function approvalProblem(e: unknown): string {
  const name = (e as { name?: string })?.name
  if (name === 'NotAllowedError') return 'That was cancelled, or it timed out. Try again when you\u2019re ready.'
  if (name === 'InvalidStateError') return 'This device already has a different account. Use its passphrase instead.'
  return 'This device could not confirm it was you. Try again, or use a passphrase.'
}
