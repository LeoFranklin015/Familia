// What storage has to be able to do, and nothing more.
//
// Two implementations sit behind this: MongoDB when `MONGODB_URI` is set, and
// the original JSON files otherwise. That is not fence-sitting — it is what
// lets the thing run on a laptop with no cluster, and on a host with no disk,
// without either being a special case in the routes.
//
// The interesting method is `updateFamily`. Every write in this app reads a
// household, waits fifteen to thirty seconds for the chain, and writes it
// back; two of those overlapping used to mean one silently lost. Both
// backends make that read-modify-write atomic, so the routes stop having to
// be careful about it.
import type { Family, Session, Vault } from '../store.js'

export type Backend = {
  ready(): Promise<void>
  describe(): string

  getFamily(id: string): Promise<Family | null>
  putFamily(family: Family): Promise<void>
  /** Atomic read-modify-write. `mutate` must be synchronous and pure enough
   *  to run more than once — it is retried if someone else got there first. */
  updateFamily(id: string, mutate: (family: Family) => void): Promise<Family>
  /** Append one activity entry and keep the newest hundred. Separate from
   *  `updateFamily` because it is a pure append: the database can do it in
   *  one atomic operation that never contends, and it is by far the most
   *  frequent write here. */
  appendActivity(familyId: string, entry: Family['activity'][number]): Promise<void>
  listFamilies(): Promise<Family[]>
  findInviteFamilyId(token: string): Promise<string | null>

  getVault(credentialId: string): Promise<Vault | null>
  /**
   * The vault for an account address.
   *
   * A passkey names its own credential, so signing in with one needs no
   * lookup. A passphrase names nothing: its credential id is a uuid this
   * server made up and only that browser ever saw. Without a way in by
   * address, clearing a browser locked a passphrase account out for good.
   */
  getVaultByAddress(address: string): Promise<Vault | null>
  putVault(vault: Vault): Promise<void>

  getSession(id: string): Promise<Session | null>
  putSession(session: Session): Promise<void>
  /** Slide an existing session's expiry. Must not create one: this runs
   *  un-awaited on reads, and an upsert here resurrects a session that was
   *  signed out a moment earlier. */
  touchSession(id: string, expiresAt: number): Promise<void>
  deleteSession(id: string): Promise<void>
  sweepSessions(now: number): Promise<void>
}

/** Thrown when an atomic update lost too many times to be worth retrying. */
export class Contended extends Error {
  constructor() { super('That household is being changed right now. Try again.') }
}
