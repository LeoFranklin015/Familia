import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetDay, when, whenLower } from './time'

const NOW = new Date('2026-08-23T12:00:00Z').getTime()
const ago = (secs: number) => NOW - secs * 1000

afterEach(() => { vi.useRealTimers() })
const at = (t: number) => { vi.useFakeTimers(); vi.setSystemTime(t) }

describe('when', () => {
  it('walks from just now to a date', () => {
    at(NOW)
    expect(when(ago(5))).toBe('Just now')
    expect(when(ago(60))).toBe('A minute ago')
    expect(when(ago(600))).toBe('10 minutes ago')
    expect(when(ago(3700))).toBe('An hour ago')
    expect(when(ago(6 * 3600))).toBe('6 hours ago')
    expect(when(ago(30 * 3600))).toBe('Yesterday')
  })

  it('says nothing for a missing timestamp rather than 56 years ago', () => {
    at(NOW)
    expect(when(0)).toBe('')
  })
})

// There were two of these: activity rows said "Just now" while the approval
// card said "just now", and they rounded differently at the boundaries.
describe('whenLower', () => {
  it('is the same clock, lowercased to sit mid-sentence', () => {
    at(NOW)
    expect(whenLower(ago(600))).toBe('10 minutes ago')
    expect(whenLower(ago(5))).toBe('just now')
    expect(whenLower(ago(60))).toBe('a minute ago')
  })

  it('reads sensibly with no timestamp', () => {
    at(NOW)
    expect(whenLower(0)).toBe('just now')
  })
})

describe('resetDay', () => {
  // Block timestamps are seconds; everything else here is milliseconds.
  it('reads a block timestamp, not a JavaScript one', () => {
    const secs = Math.floor(new Date('2026-08-23T00:00:00Z').getTime() / 1000)
    expect(resetDay(secs)).toMatch(/day$/)
  })

  it('says so when a period has no reset', () => {
    expect(resetDay(0)).toBe('Not set')
  })
})
