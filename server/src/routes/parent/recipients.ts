// The household address book: names against addresses, and nothing more.
//
// Editing it never permits anything on its own — an address becomes payable
// only when it is on some person's allowlist. That separation is what makes
// adding a shop free and instant while restricting a child is a real on-chain
// write.
import { Hono } from 'hono'
import { ethers } from 'ethers'
import { buildAllowlistBatch, feeChargedFromLogs } from '../../chain.js'
import { record, updateFamily, type Family, type Recipient } from '../../store.js'
import { waitForUserOp } from '../../wdk.js'
import { bodyOf } from '../../authorize.js'
import { parentOf, parentWrite, refuseParent } from '../guard.js'

export const recipientRoutes = new Hono()

const newId = () => `r${Math.random().toString(36).slice(2, 10)}`

recipientRoutes.post('/api/recipients', async (c) => {
  const ctx = await parentOf(c)
  if (!ctx) return refuseParent(c)
  const { name, address, kind = 'PERSON' } =
    await bodyOf<{ name: string; address: string; kind?: Recipient['kind'] }>(c)

  if (!name?.trim()) return c.json({ error: 'Give them a name.' }, 400)
  if (!ethers.isAddress(address)) return c.json({ error: "That doesn't look like an address." }, 400)
  const canonical = ethers.getAddress(address)
  if (ctx.family.recipients.some((r) => r.address.toLowerCase() === canonical.toLowerCase())) {
    return c.json({ error: 'That address is already in the book.' }, 400)
  }

  const saved = await updateFamily(ctx.family.id, (f) => {
    f.recipients.push({
      id: newId(),
      name: name.trim(),
      address: canonical,
      kind: kind === 'SHOP' ? 'SHOP' : 'PERSON',
    })
  })
  return c.json({ recipients: saved.recipients })
})

/**
 * Take an address out of the book.
 *
 * Anyone currently allowed to pay it loses that permission on-chain too,
 * otherwise the book would say one thing and the contract another. With
 * nobody holding it, this is a free local edit.
 */
recipientRoutes.post('/api/recipients/:id/remove', (c) =>
  parentWrite(c, async (account, family) => {
    const gone = family.recipients.find((r) => r.id === c.req.param('id'))
    if (!gone) return c.json({ error: 'That one is not in the book.' }, 400)

    const holders = holdersOf(family, gone.address)
    const txs = holders.flatMap((m) => buildAllowlistBatch([m.scopeId!], { deny: [gone.address] }))
    const result = txs.length
      ? await waitForUserOp(account, (await account.sendTransaction(txs)).hash)
      : null
    if (result && !result.success) {
      return c.json({ error: 'Removing it on-chain failed. Nothing changed.' }, 502)
    }

    const saved = await updateFamily(family.id, (f) => {
      f.recipients = f.recipients.filter((r) => r.id !== gone.id)
      for (const m of f.members) {
        m.allowed = (m.allowed ?? []).filter((a) => a.toLowerCase() !== gone.address.toLowerCase())
      }
    })
    if (result) {
      await record(family.id, {
        kind: 'allowance',
        text: `${gone.name} removed from the address book`,
        txHash: result.txHash,
      })
    }
    return c.json({
      recipients: saved.recipients,
      onchain: Boolean(result),
      txHash: result?.txHash,
      feeCharged: result && feeChargedFromLogs(result.logs),
    })
  }))

/** Who currently has this address on their own allowlist. */
export function holdersOf(family: Family, address: string) {
  return family.members.filter(
    (m) => m.scopeId && !m.revoked && m.allowOnly
      && m.allowed?.some((a) => a.toLowerCase() === address.toLowerCase()),
  )
}
