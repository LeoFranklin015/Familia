import { describe, expect, it } from 'vitest'
import { base, DECIMALS, figureSize, floor2, fromBase, split, splitLive, two } from './money'

describe('two', () => {
  it('renders two places', () => {
    expect(two('5')).toBe('5.00')
    expect(two('13.605')).toBe('13.61')
    expect(two(0)).toBe('0.00')
  })

  it('treats absent and unparseable as zero rather than NaN', () => {
    expect(two(null)).toBe('0.00')
    expect(two(undefined)).toBe('0.00')
    expect(two('what')).toBe('0.00')
  })
})

describe('floor2', () => {
  // The bug this exists for: `two` rounds, so a ceiling of 99999.615 became
  // 99999.62 — above the limit it came from — and "use the lot" filled the
  // field with an amount the same screen then called too much.
  it('never rounds a ceiling upward', () => {
    expect(floor2('99999.615432')).toBe('99999.61')
    expect(two('99999.615432')).toBe('99999.62')
    expect(Number(floor2('99999.615432'))).toBeLessThanOrEqual(99999.615432)
  })

  // And the mirror bug in the first fix: Math.floor(n * 100) / 100 shaves a
  // cent off values that were already exact.
  it('leaves an exact two-decimal value alone', () => {
    expect(floor2('81882.680000')).toBe('81882.68')
    expect(floor2('12.500000')).toBe('12.50')
    expect(floor2('100.00')).toBe('100.00')
  })

  it('is never above its input, over a wide sweep', () => {
    for (let i = 0; i < 2000; i++) {
      const v = (i * 7919) / 1000 + i / 999997
      expect(Number(floor2(v))).toBeLessThanOrEqual(v + 1e-9)
    }
  })
})

describe('base units', () => {
  it('round-trips', () => {
    expect(base('13.6')).toBe(13_600_000)
    expect(fromBase(13_600_000)).toBe('13.600000')
    expect(base(fromBase(1))).toBe(1)
  })

  // Why the comparisons moved to integers: as floats, `period - spent` lands
  // just under the figure displayed for it about a sixth of the time, so
  // typing exactly the number on screen read as being over the limit.
  it('makes limit arithmetic agree with what is displayed', () => {
    let disagreements = 0
    for (let period = 1; period <= 60; period++) {
      for (let cents = 0; cents <= period * 100; cents++) {
        const spent = cents / 100
        const floatLeft = period - spent
        if (Number(two(floatLeft)) > floatLeft) disagreements++
        // In base units the displayed figure is never above the real one.
        const left = base(period) - base(spent)
        expect(base(two(fromBase(left)))).toBeLessThanOrEqual(left)
      }
    }
    expect(disagreements).toBeGreaterThan(0) // the float bug is real
  })

  it("uses the token decimals", () => {
    expect(DECIMALS).toBe(6)
    expect(base('1')).toBe(10 ** DECIMALS)
  })
})

describe('split', () => {
  it('separates whole, cents and the accrued tail', () => {
    expect(split('499.999999')).toEqual({ big: '499', cents: '.99', tail: '9999' })
    expect(split('292.000052')).toEqual({ big: '292', cents: '.00', tail: '0052' })
  })

  it('drops a trailing-zero tail so a static figure stays clean', () => {
    expect(split('500.000000').tail).toBe('')
    expect(split('12.500000')).toEqual({ big: '12', cents: '.50', tail: '' })
  })

  // A digit that disappears when it reaches zero makes a ticking figure
  // jitter in width, so the live variant keeps them.
  it('keeps trailing zeros when the figure is moving', () => {
    expect(splitLive('292.000000000').tail).toBe('0000000')
    expect(splitLive('292.000056051')).toEqual({ big: '292', cents: '.00', tail: '0056051' })
  })
})

describe('figureSize', () => {
  it('steps down as the figure gets longer, so it never wraps', () => {
    const px = (s: string) => Number(figureSize(s).match(/min\((\d+)px/)![1])
    expect(px('5.00')).toBeGreaterThan(px('99999.62'))
    expect(px('99999.62')).toBeGreaterThan(px('1234567.89'))
  })

  it('also bounds by the container, for narrow and short screens', () => {
    expect(figureSize('5.00')).toContain('cqw')
    expect(figureSize('5.00')).toContain('cqh')
  })
})
