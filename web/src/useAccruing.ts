import { useEffect, useRef, useState } from 'react'

/** Aave's year, in seconds. The pool uses this exact constant. */
const YEAR = 31_536_000

/**
 * Digits carried past USDT's own six.
 *
 * Three, not four. At a fourth the final digit changes about ten times a
 * second, which reads as noise rather than as a number counting; at three it
 * ticks around once a second, which is legibly alive.
 */
export const EXTRA_DP = 3
const DP = 6 + EXTRA_DP

/**
 * A balance that keeps earning while you look at it.
 *
 * The money really is in Aave, and an aToken balance really does grow with
 * block time — `balanceOf` is `scaledBalance.rayMul(getReserveNormalizedIncome())`,
 * and that income term is recomputed from `block.timestamp` on every call. So
 * the figure moving is not decoration; it is what the position is doing.
 *
 * Two things make it honest rather than a nice animation:
 *
 * It is re-anchored to the real on-chain balance on every poll, so it can
 * never drift from the truth by more than one poll's worth of interest —
 * about a hundred-millionth of a USDT at present rates.
 *
 * And it grows by `1 + rate * elapsed / year`, which is Aave's own linear
 * interest, using the rate the pool reports. Nothing here invents a curve.
 *
 * On the extra digits: at 0.011% a year, a balance moves about a
 * billionth of a USDT per second, which is below the six decimals the token
 * can represent — the figure would sit still for a quarter of an hour and then
 * jump. Those digits are not fabricated, though. Aave holds the scaled balance
 * in ray, twenty-seven decimals, and `balanceOf` rounds it down on the way
 * out; the value between representable units genuinely exists and is
 * genuinely yours. Showing four of them is showing what the position is worth
 * rather than what the token can express, which is why they are rendered
 * smaller than the cents rather than beside them.
 */
export function useAccruing(
  /** The last on-chain balance, as a decimal string. */
  balance: string,
  /** Aave's annual supply rate, as a fraction. Zero holds the figure still. */
  apr: number,
  /** When `balance` was read, in epoch ms. */
  readAt: number,
): string {
  const [now, setNow] = useState(() => Date.now())

  // Anchor and rate change on every poll; keeping them in a ref means the
  // ticking effect below is set up once rather than torn down ten times a
  // minute.
  const anchor = useRef({ balance, apr, readAt })
  anchor.current = { balance, apr, readAt }

  const live = apr > 0 && Number(balance) > 0

  useEffect(() => {
    if (!live) return
    // Five times a second. The last digit only changes about once a second,
    // so this is comfortably enough to catch it promptly without a timer
    // running at animation speed for the life of the screen.
    const t = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(t)
  }, [live])

  if (!live) return balance

  return project(anchor.current.balance, anchor.current.apr, anchor.current.readAt, now)
}

/**
 * `balance * (1 + apr * elapsed / year)`, in fixed-point.
 *
 * Done in BigInt at ten decimal places because the interesting part is the
 * tail: a double has the range for it but the whole point is the last digit,
 * and that is exactly where binary floating point stops being trustworthy.
 */
export function project(balance: string, apr: number, readAt: number, now: number): string {
  const units = toUnits(balance)
  const elapsed = Math.max(0, (now - readAt) / 1000)

  // The gain is minute, so it computes safely as a double before becoming an
  // integer of the same fixed-point scale.
  const gain = BigInt(Math.floor(Number(units) * apr * elapsed / YEAR))
  return fromUnits(units + gain)
}

function toUnits(decimal: string): bigint {
  const [whole = '0', frac = ''] = decimal.split('.')
  return BigInt(whole + frac.padEnd(DP, '0').slice(0, DP))
}

function fromUnits(units: bigint): string {
  const s = units.toString().padStart(DP + 1, '0')
  return `${s.slice(0, -DP)}.${s.slice(-DP)}`
}
