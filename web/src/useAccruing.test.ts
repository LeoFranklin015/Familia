import { describe, expect, it } from 'vitest'
import { project } from './useAccruing'

const APR = 0.000111          // Base Sepolia's real USDT supply rate
const BALANCE = '292.000056'
const T0 = 1_700_000_000_000

describe('project', () => {
  it('grows by Aave’s own linear interest', () => {
    // balance * (1 + apr * elapsed / year)
    const hour = project(BALANCE, APR, T0, T0 + 3_600_000)
    const expected = 292.000056 * (1 + APR * 3600 / 31_536_000)
    expect(Number(hour)).toBeCloseTo(expected, 8)
  })

  it('holds still with no rate', () => {
    expect(project(BALANCE, 0, T0, T0 + 3_600_000)).toBe('292.000056000')
  })

  it('never goes backwards as time passes', () => {
    let last = -1
    for (let s = 0; s <= 600; s += 7) {
      const v = Number(project(BALANCE, APR, T0, T0 + s * 1000))
      expect(v).toBeGreaterThanOrEqual(last)
      last = v
    }
  })

  it('ignores a clock that went backwards', () => {
    expect(project(BALANCE, APR, T0, T0 - 5000)).toBe('292.000056000')
  })

  it('carries more precision than the token can express', () => {
    // At this rate the balance moves ~1e-9 per second, below USDT's six
    // decimals — which is the whole reason the extra digits exist.
    const a = project(BALANCE, APR, T0, T0)
    const b = project(BALANCE, APR, T0, T0 + 10_000)
    expect(a).not.toBe(b)
    expect(a.slice(0, 10)).toBe(b.slice(0, 10)) // six decimals unchanged
  })
})

/**
 * The bug: the anchor was reset on every ten-second poll, and the chain's six
 * decimals only move every quarter of an hour at this rate — so the accrued
 * digits restarted from zero ten times a minute. A sawtooth, not a counter.
 */
describe('the poll cycle', () => {
  const POLL = 10_000

  it('sawtooths when re-anchored to each read', () => {
    const seen = [0, 4, 8, 12, 16, 20].map((s) =>
      Number(project(BALANCE, APR, T0 + Math.floor(s / 10) * POLL, T0 + s * 1000)))
    // It goes down at every poll boundary.
    expect(seen[3]).toBeLessThan(seen[2])
  })

  it('climbs when the anchor is carried and only corrected upward', () => {
    let anchor = { base: BALANCE, at: T0 }
    let last = -1
    for (let s = 0; s <= 60; s += 2) {
      const now = T0 + s * 1000
      // A poll arrives; the chain has not moved at six decimals.
      if (s > 0 && s % 10 === 0) {
        anchor = { base: project(anchor.base, APR, anchor.at, now), at: now }
      }
      const shown = Number(project(anchor.base, APR, anchor.at, now))
      expect(shown).toBeGreaterThanOrEqual(last)
      last = shown
    }
    expect(last).toBeGreaterThan(Number(BALANCE))
  })
})
