import { describe, expect, it } from 'vitest'
import { isAllowed, labelFor, looksLikeAddress, matchRecipient, sameAddress, shortAddress } from './address'
import type { Recipient } from '../api'

const SHOP: Recipient = {
  id: 'r1', name: 'Corner Store', kind: 'SHOP',
  address: '0x1111000000000000000000000000000000001111',
}
const MIXED = '0xAbC1000000000000000000000000000000001111'

describe('looksLikeAddress', () => {
  it('accepts a full address in any casing', () => {
    expect(looksLikeAddress(SHOP.address)).toBe(true)
    expect(looksLikeAddress(MIXED)).toBe(true)
    expect(looksLikeAddress(`  ${SHOP.address}  `)).toBe(true)
  })

  it('rejects anything the chain would not accept', () => {
    expect(looksLikeAddress('')).toBe(false)
    expect(looksLikeAddress('0x123')).toBe(false)
    expect(looksLikeAddress(`${SHOP.address}0`)).toBe(false)
    expect(looksLikeAddress('1111000000000000000000000000000000001111')).toBe(false)
  })
})

// Ethereum addresses are checksummed by case, so the same address can arrive
// spelled two ways — from a QR code, a paste, or the chain. A `===` between
// them is a bug waiting for the right input.
describe('case insensitivity', () => {
  it('treats the same address spelled differently as the same', () => {
    expect(sameAddress(MIXED, MIXED.toLowerCase())).toBe(true)
    expect(sameAddress(MIXED, MIXED.toUpperCase().replace('0X', '0x'))).toBe(true)
    expect(sameAddress(` ${MIXED} `, MIXED.toLowerCase())).toBe(true)
  })

  it('matches a recipient regardless of casing', () => {
    expect(matchRecipient([SHOP], SHOP.address.toUpperCase().replace('0X', '0x'))?.name)
      .toBe('Corner Store')
  })

  it('checks an allowlist regardless of casing', () => {
    expect(isAllowed([MIXED], MIXED.toLowerCase())).toBe(true)
    expect(isAllowed([], MIXED)).toBe(false)
  })

  it('does not match a different address', () => {
    expect(sameAddress(MIXED, SHOP.address)).toBe(false)
    expect(matchRecipient([SHOP], MIXED)).toBeNull()
  })
})

describe('labelFor', () => {
  it('prefers the household name', () => {
    expect(labelFor([SHOP], SHOP.address)).toBe('Corner Store')
  })

  it('falls back to a shortened address', () => {
    expect(labelFor([SHOP], MIXED)).toBe('0xAbC1…1111')
  })
})

describe('shortAddress', () => {
  it('shortens a full address', () => {
    expect(shortAddress(SHOP.address)).toBe('0x1111…1111')
  })

  it('leaves something already short alone', () => {
    expect(shortAddress('0x1234')).toBe('0x1234')
    expect(shortAddress('')).toBe('')
  })
})
