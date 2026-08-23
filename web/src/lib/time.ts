/**
 * Time, said the way a person says it.
 *
 * One formatter, because there were two: activity rows said "Just now" while
 * the approval card said "just now", and they rounded differently at the
 * boundaries. Same event, two voices.
 */

const MINUTE = 60
const HOUR = 3600
const DAY = 86400

/** Relative for the first day, then the weekday, then the date. Nobody wants
 *  a timestamp on their own spending. */
export function when(at: number): string {
  if (!at) return ''
  const secs = Math.round((Date.now() - at) / 1000)
  if (secs < 45) return 'Just now'
  if (secs < 90) return 'A minute ago'
  if (secs < HOUR) return `${Math.round(secs / MINUTE)} minutes ago`
  if (secs < 1.5 * HOUR) return 'An hour ago'
  if (secs < DAY) return `${Math.round(secs / HOUR)} hours ago`
  if (secs < 2 * DAY) return 'Yesterday'
  const d = new Date(at)
  if (secs < 7 * DAY) return d.toLocaleDateString(undefined, { weekday: 'long' })
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** The same clock, lowercased to sit mid-sentence: "Asked 2 minutes ago". */
export function whenLower(at: number): string {
  const s = when(at)
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : 'just now'
}

/** "Sunday", for a period that resets. Seconds, because it comes from a
 *  block timestamp rather than from JavaScript. */
export function resetDay(atSeconds: number): string {
  if (!atSeconds) return 'Not set'
  return new Date(atSeconds * 1000).toLocaleDateString(undefined, { weekday: 'long' })
}
