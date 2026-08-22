// Family creation, invites, join, and session unlock. Invite links carry a
// one-time token and no key material — the key is born on the joining device.
import { Hono, type Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { createFamily, findByCredentialId, findInvite, getFamily, mustFamily, newInvite, save } from '../store.js'
import { createVaultEntry, openVaultEntry, type KeySource } from '../vault.js'
import { addressForMnemonic, createSession, destroySession, getSession } from '../wdk.js'
import { randomUUID } from 'node:crypto'

export const joinRoutes = new Hono()

const COOKIE = 'kin_session'

export function currentSession(c: Context<any, any, any>) {
  return getSession(getCookie(c, COOKIE))
}

joinRoutes.post('/api/family', async (c) => {
  if (getFamily()) return c.json({ error: 'A family already exists on this server.' }, 409)
  const { name, parentName } = await c.req.json()
  if (!name || !parentName) return c.json({ error: 'name and parentName are required' }, 400)
  const { parentJoinToken } = createFamily(name, parentName)
  return c.json({ joinPath: `/join/${parentJoinToken}` })
})

joinRoutes.post('/api/invites', async (c) => {
  const s = currentSession(c)
  if (s?.role !== 'parent') return c.json({ error: 'parent only' }, 403)
  const { name } = await c.req.json()
  if (!name) return c.json({ error: 'name is required' }, 400)
  return c.json({ joinPath: `/join/${newInvite(name)}` })
})

joinRoutes.get('/api/join/:token', (c) => {
  const f = getFamily()
  if (!f) return c.json({ error: 'no family' }, 404)
  const invite = findInvite(c.req.param('token'))
  if (!invite) return c.json({ error: 'This invite link was already used or does not exist.' }, 404)
  return c.json({
    familyName: f.name,
    inviteeName: invite.name,
    isParent: invite.token === f.parentInviteToken && !f.parent,
  })
})

joinRoutes.post('/api/join/:token', async (c) => {
  const f = mustFamily()
  const invite = findInvite(c.req.param('token'))
  if (!invite) return c.json({ error: 'This invite link was already used or does not exist.' }, 404)

  const body = (await c.req.json()) as KeySource & { credentialId?: string }
  const credentialId = body.credentialId ?? `pass:${randomUUID()}`
  const { mnemonic, ciphertextHex, saltHex } = await createVaultEntry(body)
  const address = await addressForMnemonic(mnemonic)
  const vault = { ciphertextHex, saltHex, credentialId, prf: Boolean(body.prfKeyHex) }

  const isParent = invite.token === f.parentInviteToken && !f.parent
  let memberId: string | undefined
  if (isParent) {
    f.parent = { name: invite.name, address, vault }
  } else {
    memberId = randomUUID()
    f.members.push({ id: memberId, name: invite.name, address, vault, joinedAt: Date.now() })
  }
  invite.usedBy = address
  save()

  const session = await createSession(isParent ? 'parent' : 'member', memberId, mnemonic)
  setCookie(c, COOKIE, session.id, { httpOnly: true, sameSite: 'Lax', path: '/' })
  return c.json({ role: session.role, address, credentialId })
})

joinRoutes.post('/api/session', async (c) => {
  const body = (await c.req.json()) as KeySource & { credentialId: string }
  const found = findByCredentialId(body.credentialId)
  if (!found) return c.json({ error: 'No account for this passkey on this server.' }, 404)
  let mnemonic: string
  try {
    mnemonic = await openVaultEntry(found.vault, body)
  } catch {
    return c.json({ error: 'Could not unlock — wrong key or passphrase.' }, 401)
  }
  const session = await createSession(found.role, found.member?.id, mnemonic)
  setCookie(c, COOKIE, session.id, { httpOnly: true, sameSite: 'Lax', path: '/' })
  return c.json({ role: session.role, address: session.address })
})

joinRoutes.post('/api/logout', (c) => {
  const id = getCookie(c, COOKIE)
  if (id) destroySession(id)
  deleteCookie(c, COOKIE)
  return c.json({ ok: true })
})

joinRoutes.get('/api/whoami', (c) => {
  const s = currentSession(c)
  if (!s) return c.json({ role: null })
  return c.json({ role: s.role, address: s.address, memberId: s.memberId ?? null })
})
