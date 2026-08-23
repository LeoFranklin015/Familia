import type { Family } from '../store.js'

/**
 * What to call an address in something a person reads.
 *
 * The household's name for it where there is one, the shortened address
 * otherwise. This existed twice — `payeeName` on the member routes and
 * `recipientName` on the guardian's, with character-identical bodies — which
 * is one copy too many for a rule about how money is described.
 */
export function payeeName(family: Family, address: string): string {
  const known = family.recipients.find(
    (r) => r.address.toLowerCase() === address.toLowerCase(),
  )
  return known?.name ?? shortAddress(address)
}

export function shortAddress(address: string): string {
  return address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}
