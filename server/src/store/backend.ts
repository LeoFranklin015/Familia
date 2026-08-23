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
  listFamilies(): Promise<Family[]>
  findInviteFamilyId(token: string): Promise<string | null>

  getVault(credentialId: string): Promise<Vault | null>
  putVault(vault: Vault): Promise<void>

  getSession(id: string): Promise<Session | null>
  putSession(session: Session): Promise<void>
  deleteSession(id: string): Promise<void>
  sweepSessions(now: number): Promise<void>
}

/** Thrown when an atomic update lost too many times to be worth retrying. */
export class Contended extends Error {
  constructor() { super('That household is being changed right now. Try again.') }
}
