/**
 * Money, in one place.
 *
 * Two rules run through all of this. Amounts arrive as decimal strings with
 * six places, because that is what USDT has and what the chain returns; and
 * comparisons happen in whole base units, never as floats, because
 * `period - spent` as a double lands just under the figure displayed for it
 * about a sixth of the time — which made typing exactly the number on screen
 * read as being over the limit.
 */

/** USDT's decimals. The chain's unit, and the one every string here uses. */
export const DECIMALS = 6

/** Two decimal places, for a figure sitting inline in a sentence. */
export function two(value: string | number | null | undefined): string {
  const n = Number(value ?? 0)
  return (Number.isFinite(n) ? n : 0).toFixed(2)
}

/**
 * Two decimal places, truncated rather than rounded.
 *
 * For a ceiling this is the difference between working and not: rounding
 * 99999.615 up to 99999.62 puts the figure above the limit it came from, so
 * "use the lot" fills the field with an amount the same screen calls too much.
 * Truncating the decimal string rather than scaling by 100, because `n * 100`
 * is inexact and `Math.floor` then shaves a cent off figures that were already
 * exact to two places.
 */
export function floor2(value: string | number | null | undefined): string {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return '0.00'
  const [whole, frac = ''] = n.toFixed(DECIMALS).split('.')
  return `${whole}.${frac.slice(0, 2).padEnd(2, '0')}`
}

/** An amount as an integer of base units, for comparing without float error. */
export function base(value: string | number | null | undefined): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? Math.round(n * 10 ** DECIMALS) : 0
}

/** Base units back to a decimal string. */
export function fromBase(units: number): string {
  return (units / 10 ** DECIMALS).toFixed(DECIMALS)
}

export type Split = { big: string; cents: string; tail: string }

/**
 * A figure in three parts: whole, cents, and whatever precision is left.
 *
 * aTokens accrue continuously, so a balance always carries more decimals than
 * anyone wants to read. The tail is rendered smaller so the number stays
 * legible without the extra precision being hidden.
 */
export function split(value: string): Split {
  const n = Number(value || '0')
  const s = (Number.isFinite(n) ? n : 0).toFixed(DECIMALS)
  const [whole, frac] = s.split('.')
  return { big: whole, cents: `.${frac.slice(0, 2)}`, tail: frac.slice(2).replace(/0+$/, '') }
}

/** Like `split`, but keeps trailing zeros. A digit that disappears when it
 *  reaches zero makes a ticking figure jitter in width. */
export function splitLive(value: string): Split {
  const [whole = '0', frac = ''] = value.split('.')
  return { big: whole, cents: `.${frac.slice(0, 2).padEnd(2, '0')}`, tail: frac.slice(2) }
}

/**
 * A font size that keeps a figure on one line.
 *
 * Tabular digits run about 0.6em wide, so the width budget goes quickly: at
 * 62px, eight characters need roughly 300px and wrap inside a 402px phone. The
 * ceiling steps down with length; `cqw` and `cqh` handle narrow and short
 * screens on top of that.
 */
export function figureSize(text: string): string {
  const n = text.length
  const px = n <= 5 ? 62 : n <= 6 ? 56 : n <= 7 ? 50 : n <= 8 ? 44 : n <= 10 ? 36 : 30
  return `min(${px}px, 15cqw, 9cqh)`
}
