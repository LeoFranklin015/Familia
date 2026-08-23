// Creating a household, joining one, signing in, and saying who you are.
//
// This server hosts many families. An invite token identifies which one, and a
// credential id identifies an account within it — so nothing here depends on
// there being a single household.
//
// Invite links carry a one-time token and no key material: the key is born on
// the joining device and never leaves it in a form anyone else can use.
import { Hono } from 'hono'
import { setCookie, deleteCookie, getCookie } from 'hono/cookie'
import { randomUUID } from 'node:crypto'
import {
  createFamily, findInvite, getFamily, getVault, mustFamily, newInvite, putVault, saveFamily,
} from '../store.js'
import { createVaultEntry, openVaultEntry, type KeySource } from '../vault.js'
import { addressForMnemonic, createSession, destroySession } from '../wdk.js'
import { bootstrapParent } from '../bootstrap.js'
import { COOKIE, currentSession } from '../authorize.js'

export const joinRoutes = new Hono()

joinRoutes.post('/api/family', async (c) => {
  const { name, parentName } = await c.req.json()
  if (!name?.trim() || !parentName?.trim()) return c.json({ error: 'A family name and your name are needed.' }, 400)
  const { parentJoinToken } = createFamily(name.trim(), parentName.trim())
  return c.json({ joinPath: `/join/${parentJoinToken}` })
})

joinRoutes.post('/api/invites', async (c) => {
  const s = currentSession(c)
  if (s?.role !== 'parent') return c.json({ error: 'parent only' }, 403)
  const { name } = await c.req.json()
  if (!name?.trim()) return c.json({ error: 'A name is needed.' }, 400)
  return c.json({ joinPath: `/join/${newInvite(mustFamily(s.familyId), name.trim())}` })
})

joinRoutes.get('/api/join/:token', (c) => {
  const found = findInvite(c.req.param('token'))
  if (!found) return c.json({ error: 'This invite link was already used or does not exist.' }, 404)
  return c.json({
    familyName: found.family.name,
    inviteeName: found.invite.name,
    isParent: found.invite.token === found.family.parentInviteToken && !found.family.parent,
  })
})

joinRoutes.post('/api/join/:token', async (c) => {
  const found = findInvite(c.req.param('token'))
  if (!found) return c.json({ error: 'This invite link was already used or does not exist.' }, 404)
  const { family, invite } = found

  const body = (await c.req.json()) as KeySource & { credentialId?: string }
  const credentialId = body.credentialId ?? `pass:${randomUUID()}`
  if (getVault(credentialId)) return c.json({ error: 'That passkey is already in use.' }, 409)

  // Entropy is generated and encrypted here, then only the ciphertext is kept.
  const { mnemonic, ciphertextHex, saltHex } = await createVaultEntry(body)
  const address = await addressForMnemonic(mnemonic)

  const isParent = invite.token === family.parentInviteToken && !family.parent
  const memberId = isParent ? undefined : randomUUID()

  putVault({
    credentialId, ciphertextHex, saltHex, prf: Boolean(body.prfKeyHex),
    familyId: family.id, role: isParent ? 'parent' : 'member', memberId,
    address, name: invite.name,
  })

  if (isParent) family.parent = { name: invite.name, address, credentialId }
  else family.members.push({ id: memberId!, name: invite.name, address, credentialId, joinedAt: Date.now() })
  invite.usedBy = address
  saveFamily(family)

  const session = createSession({
    familyId: family.id, role: isParent ? 'parent' : 'member', memberId,
    credentialId, address, name: invite.name,
  })
  setCookie(c, COOKIE, session.id, { httpOnly: true, sameSite: 'Lax', path: '/' })

  // Fund the parent's account as part of signing up rather than surprising
  // them inside their first deposit. Needs the key, so it runs here while we
  // still hold the mnemonic — and disposes it when done.
  if (isParent) bootstrapParent({ familyId: family.id, address, mnemonic })

  return c.json({ role: session.role, address, credentialId, familyName: family.name })
})

joinRoutes.post('/api/session', async (c) => {
  const body = (await c.req.json()) as KeySource & { credentialId: string }
  const vault = getVault(body.credentialId)
  if (!vault) return c.json({ error: 'No account for this passkey.' }, 404)

  // Unlocking proves the key works before a session is handed out; the
  // mnemonic is used for nothing else here and goes out of scope immediately.
  try {
    await openVaultEntry(vault, body)
  } catch {
    return c.json({ error: 'Could not unlock. Wrong key or passphrase.' }, 401)
  }

  const family = getFamily(vault.familyId)
  if (!family) return c.json({ error: 'That family no longer exists.' }, 404)

  const session = createSession({
    familyId: vault.familyId, role: vault.role, memberId: vault.memberId,
    credentialId: vault.credentialId, address: vault.address, name: vault.name,
  })
  setCookie(c, COOKIE, session.id, { httpOnly: true, sameSite: 'Lax', path: '/' })
  return c.json({ role: session.role, address: vault.address, familyName: family.name })
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
  const family = getFamily(s.familyId)
  return c.json({
    role: s.role,
    address: s.address,
    memberId: s.memberId ?? null,
    credentialId: s.credentialId,
    familyName: family?.name ?? null,
  })
})
