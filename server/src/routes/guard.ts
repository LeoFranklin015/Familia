// Who is asking, and may they.
//
// Both surfaces need the same four beats — identify the session, load the
// household, open the vault with the key just presented, and turn a refusal
// into something the interface can act on. They had one each.
import type { Context } from 'hono'
import { actAs, currentSession, refuse } from '../authorize.js'
import { canPayFeesInUsdt } from '../chain.js'
import { mustFamily, type Family, type Member } from '../store.js'
import type { GaslessAccount } from '../wdk.js'

/** The guardian's session and household, or null if this isn't them. */
export async function parentOf(c: Context<any, any, any>) {
  const s = await currentSession(c)
  if (s?.role !== 'parent') return null
  return { session: s, family: await mustFamily(s.familyId) }
}

/** The member's session, household and own record. */
export async function memberOf(c: Context<any, any, any>) {
  const s = await currentSession(c)
  if (s?.role !== 'member' || !s.memberId) return null
  const family = await mustFamily(s.familyId)
  const member = family.members.find((m) => m.id === s.memberId)
  return member ? { session: s, family, member } : null
}

export const refuseParent = (c: Context<any, any, any>) =>
  refuse(c, 'This account is not the one that set up the household.')

export const refuseMember = (c: Context<any, any, any>) =>
  refuse(c, 'This account cannot spend from that household.')

type ParentAction = (
  account: GaslessAccount,
  family: Family,
  address: string,
) => Promise<Response>

/**
 * A guardian write: authorise, act.
 *
 * The household is re-read inside, after the vault is open, so the callback
 * always works from the current record rather than one loaded before the
 * authorisation round trip.
 *
 * Nothing is caught here. `AuthError` and the rest are translated once, in the
 * app's error handler, so a route never has to remember a try/catch.
 */
export async function parentWrite(c: Context<any, any, any>, fn: ParentAction): Promise<Response> {
  const ctx = await parentOf(c)
  if (!ctx) return refuseParent(c)
  // The guardian pays their own fees in USD₮ once they hold some; before that
  // there is nothing to pay with, so the first operation is sponsored.
  const payFeesInUsdt = await canPayFeesInUsdt(ctx.session.address)
  return actAs(c, { role: 'parent', payFeesInUsdt }, async (account) =>
    fn(account, await mustFamily(ctx.session.familyId), ctx.session.address))
}

/** A member write. Always sponsored: a child should never need a balance to
 *  spend an allowance. */
export async function memberWrite(
  c: Context<any, any, any>,
  fn: (account: GaslessAccount, family: Family, member: Member) => Promise<Response>,
): Promise<Response> {
  const ctx = await memberOf(c)
  if (!ctx) return refuseMember(c)
  return actAs(c, { role: 'member' }, async (account) => {
    const family = await mustFamily(ctx.session.familyId)
    const member = family.members.find((m) => m.id === ctx.member.id)
    if (!member) return refuseMember(c)
    return fn(account, family, member)
  })
}
