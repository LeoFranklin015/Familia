import type { Recipient } from '../api'

/**
 * Addresses, and the names a household has given them.
 *
 * Every comparison here is case-insensitive. Ethereum addresses are
 * checksummed by case, so the same address can arrive spelled two ways — from
 * a QR code, a paste, or the chain — and a `===` between them is a bug waiting
 * for the right input.
 */

/** Good enough to submit. The chain does the real checking; this only decides
 *  whether a button is live. */
export function looksLikeAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value.trim())
}

export function sameAddress(a: string, b: string): boolean {
  return Boolean(a) && a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** `0x1234…abcd`, for anywhere a full address would crowd the line out. */
export function shortAddress(value: string): string {
  return value && value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value || ''
}

/** The household's entry for an address, if it has one. */
export function matchRecipient(recipients: Recipient[], address: string): Recipient | null {
  const wanted = address.trim().toLowerCase()
  if (!wanted) return null
  return recipients.find((r) => r.address.toLowerCase() === wanted) ?? null
}

/** A name where the household has one, the shortened address otherwise. */
export function labelFor(recipients: Recipient[], address: string): string {
  return matchRecipient(recipients, address)?.name ?? shortAddress(address.trim())
}

/** Whether an address is on a list of allowed ones. */
export function isAllowed(allowed: string[], address: string): boolean {
  return allowed.some((a) => sameAddress(a, address))
}
