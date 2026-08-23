import type { ReactNode } from 'react'

/**
 * An amount, split three ways.
 *
 * The whole number carries the weight, the cents step back, and anything past
 * two decimals recedes almost out of sight — aTokens accrue continuously, so
 * a balance always has more precision than anyone wants to read. Tabular
 * throughout, so digits don't shift as the figure changes.
 */
export function Figure({
  value, unit, size = 'xl',
}: {
  value: string
  /** Shown small and low, after the tail. Omit inside a card that already
   *  names the currency. */
  unit?: string
  size?: 'xl' | 'md'
}) {
  const { big, cents, tail } = split(value)
  return (
    <div className={`figure${size === 'md' ? ' figure--md' : ''}`}>
      <span className="figure__big">{big}</span>
      <span className="figure__cents">{cents}</span>
      {tail && <span className="figure__tail">{tail}</span>}
      {unit && <span className="figure__unit">{unit}</span>}
    </div>
  )
}

/** `499.999999` → `499` · `.99` · `9999`. */
export function split(value: string): { big: string; cents: string; tail: string } {
  const n = Number(value || '0')
  const s = (Number.isFinite(n) ? n : 0).toFixed(6)
  const [w, d] = s.split('.')
  return { big: w, cents: `.${d.slice(0, 2)}`, tail: d.slice(2).replace(/0+$/, '') }
}

/** Two decimals, for anywhere a figure sits inline rather than on display. */
export function two(value: string | number | null | undefined): string {
  const n = Number(value ?? 0)
  return (Number.isFinite(n) ? n : 0).toFixed(2)
}

/**
 * Two decimals, truncated rather than rounded.
 *
 * For a ceiling this is the difference between working and not: rounding
 * 99999.615 to 99999.62 puts the figure *above* the limit it came from, so
 * "use the lot" fills the field with an amount the same screen then calls too
 * much.
 */
export function floor2(v: string | number | null | undefined): string {
  const n = Number(v ?? 0)
  if (!Number.isFinite(n)) return '0.00'
  // Truncate the decimal string rather than scaling by 100: `n * 100` is
  // inexact, and `Math.floor` then shaves a cent off figures that were
  // already exact to two places ("81882.680000" → "81882.67").
  const [w, d = ''] = n.toFixed(6).split('.')
  return `${w}.${d.slice(0, 2).padEnd(2, '0')}`
}

/**
 * An amount as an integer of base units.
 *
 * Money compared as a float disagrees with money displayed as a float, and the
 * gap is not rare: for 17% of (weekly limit, spent) pairs, `limit - spent`
 * lands just under the two-decimal figure shown for it — so typing exactly the
 * number on screen reads as *over* the limit. The chain has no such problem,
 * because it only ever works in whole base units. Neither should we.
 */
export function base(v: string | number | null | undefined): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? Math.round(n * 1e6) : 0
}

/** Back to a display string. */
export function fromBase(units: number): string {
  return (units / 1e6).toFixed(6)
}

/**
 * A font size that keeps a figure on one line.
 *
 * Tabular digits run about 0.6em wide, so the width budget goes quickly: at
 * 62px, eight characters need ~300px and wrap inside a 402px phone. The
 * ceiling steps down with length, and `cqw` handles narrow screens on top of
 * that.
 */
export function figureSize(text: string): string {
  const n = text.length
  const px = n <= 5 ? 62 : n <= 6 ? 56 : n <= 7 ? 50 : n <= 8 ? 44 : n <= 10 ? 36 : 30
  // Three ceilings: the figure's own length, the container's width, and its
  // height — a short window is the case that actually overflows.
  return `min(${px}px, 15cqw, 9cqh)`
}

export function shortAddress(a: string): string {
  return a && a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || ''
}

/** Content-shaped placeholder. A screen that knows its shape shouldn't
 *  collapse to a spinner and then jump. */
export function Skeleton({ h = 16, w = '100%', mt = 0, r }: { h?: number; w?: string; mt?: number; r?: number }) {
  return <div className="skel" style={{ height: h, width: w, marginTop: mt, borderRadius: r }} aria-hidden="true" />
}

export function ScreenSkeleton({ label }: { label: string }) {
  return (
    <div className="page" aria-busy="true" aria-label={label}>
      <Skeleton h={12} w="40%" mt={0} />
      <div className="mt3"><Skeleton h={168} r={28} /></div>
      <div className="pair mt2">
        <Skeleton h={96} r={18} />
        <Skeleton h={96} r={18} />
      </div>
      <div className="mt5"><Skeleton h={12} w="25%" /></div>
      <Skeleton h={44} mt={14} />
      <Skeleton h={44} mt={10} />
      <span className="sr-only">{label}</span>
    </div>
  )
}

/** Soft green shapes behind things, so a screen is never only rectangles. */
export function Blob({ size, top, left, right, bottom, rotate = -18, opacity = 0.38 }: {
  size: number
  top?: number; left?: number; right?: number; bottom?: number
  rotate?: number
  opacity?: number
}) {
  return (
    <div
      className="blob"
      aria-hidden="true"
      style={{
        width: size, height: size, top, left, right, bottom, opacity,
        transform: `rotate(${rotate}deg) skewX(-7deg)`,
      }}
    />
  )
}

/**
 * The mark: money held inside a boundary.
 *
 * Drawn rather than lettered — it has to survive being 18px in a tab and
 * 40px on a splash, and a wordmark does neither.
 */
export function Mark({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="38" height="38" rx="13" stroke="currentColor" strokeWidth="2.4" opacity="0.3" />
      <circle cx="22" cy="22" r="8.5" fill="currentColor" />
    </svg>
  )
}

/* ── Icons ─────────────────────────────────────────────────────────────────
   One weight, one grid, filled — so they sit against type rather than
   competing with it. Sized at the call site; colour is inherited. */

const P: Record<string, string> = {
  home: 'M218.83,103.77l-80-75.48a16,16,0,0,0-21.66,0l-80,75.48A16,16,0,0,0,32,115.55V208a16,16,0,0,0,16,16H96a16,16,0,0,0,16-16V160h32v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V115.55A16,16,0,0,0,218.83,103.77ZM208,208H160V160a16,16,0,0,0-16-16H112a16,16,0,0,0-16,16v48H48V115.55l.11-.1L128,40l79.9,75.43.11.1Z',
  pay: 'M216,64H56a8,8,0,0,1,0-16H192a8,8,0,0,0,0-16H56A24,24,0,0,0,32,56V184a24,24,0,0,0,24,24H216a16,16,0,0,0,16-16V80A16,16,0,0,0,216,64Zm0,128H56a8,8,0,0,1-8-8V78.63A23.84,23.84,0,0,0,56,80H216ZM184,144a12,12,0,1,1,12-12A12,12,0,0,1,184,144Z',
  family: 'M117.25,157.92a60,60,0,1,0-66.5,0A95.83,95.83,0,0,0,3.53,195.63a8,8,0,1,0,13.4,8.74,80,80,0,0,1,134.14,0,8,8,0,0,0,13.4-8.74A95.83,95.83,0,0,0,117.25,157.92ZM40,108a44,44,0,1,1,44,44A44.05,44.05,0,0,1,40,108Zm210.14,98.7a8,8,0,0,1-11.07-2.33A79.83,79.83,0,0,0,172,168a8,8,0,0,1,0-16,44,44,0,1,0-16.34-84.87,8,8,0,1,1-6.05-14.81,60,60,0,0,1,55.64,105.6,95.83,95.83,0,0,1,47.22,37.71A8,8,0,0,1,250.14,206.7Z',
  activity: 'M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm64-88a8,8,0,0,1-8,8H128a8,8,0,0,1-8-8V72a8,8,0,0,1,16,0v48h48A8,8,0,0,1,192,128Z',
  info: 'M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm16-40a8,8,0,0,1-8,8,16,16,0,0,1-16-16V128a8,8,0,0,1,0-16,16,16,0,0,1,16,16v40A8,8,0,0,1,144,176ZM112,84a12,12,0,1,1,12,12A12,12,0,0,1,112,84Z',
  face: 'M40,88a8,8,0,0,1-8-8V48A16,16,0,0,1,48,32H80a8,8,0,0,1,0,16H48V80A8,8,0,0,1,40,88ZM216,32H184a8,8,0,0,0,0,16h32V80a8,8,0,0,0,16,0V48A16,16,0,0,0,216,32Zm0,136a8,8,0,0,0-8,8v32H176a8,8,0,0,0,0,16h32a16,16,0,0,0,16-16V176A8,8,0,0,0,216,168ZM80,208H48V176a8,8,0,0,0-16,0v32a16,16,0,0,0,16,16H80a8,8,0,0,0,0-16ZM92,116a12,12,0,1,1,12-12A12,12,0,0,1,92,116Zm72,0a12,12,0,1,1,12-12A12,12,0,0,1,164,116Zm5.61,32a8,8,0,0,1-2.93,10.93,52,52,0,0,1-77.36,0A8,8,0,0,1,99.9,151a36,36,0,0,0,56.2,0A8,8,0,0,1,169.61,148Z',
  qr: 'M104,40H56A16,16,0,0,0,40,56v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V56A16,16,0,0,0,104,40Zm0,64H56V56h48Zm96-64H152a16,16,0,0,0-16,16v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V56A16,16,0,0,0,200,40Zm0,64H152V56h48Zm-96,32H56a16,16,0,0,0-16,16v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V152A16,16,0,0,0,104,136Zm0,64H56V152h48Zm96-64H152a16,16,0,0,0-16,16v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V152A16,16,0,0,0,200,136Zm0,64H152V152h48Z',
  x: 'M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z',
  check: 'M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z',
  shop: 'M216,64H176a48,48,0,0,0-96,0H40A16,16,0,0,0,24,80V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V80A16,16,0,0,0,216,64ZM128,32a32,32,0,0,1,32,32H96A32,32,0,0,1,128,32ZM216,200H40V80H216V200Z',
  person: 'M230.92,212c-15.23-26.33-38.7-45.21-66.09-54.16a72,72,0,1,0-73.66,0C63.78,166.78,40.31,185.66,25.08,212a8,8,0,1,0,13.85,8c18.84-32.56,52.14-52,89.07-52s70.23,19.44,89.07,52a8,8,0,1,0,13.85-8ZM72,96a56,56,0,1,1,56,56A56.06,56.06,0,0,1,72,96Z',
  external: 'M216,104a8,8,0,0,1-16,0V59.32l-66.33,66.34a8,8,0,0,1-11.32-11.32L188.68,48H144a8,8,0,0,1,0-16h64a8,8,0,0,1,8,8Zm-24,24a8,8,0,0,0-8,8v56H56V64h56a8,8,0,0,0,0-16H56A16,16,0,0,0,40,64V192a16,16,0,0,0,16,16H184a16,16,0,0,0,16-16V136A8,8,0,0,0,192,128Z',
  right: 'M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z',
  up: 'M213.66,165.66a8,8,0,0,1-11.32,0L128,91.31,53.66,165.66a8,8,0,0,1-11.32-11.32l80-80a8,8,0,0,1,11.32,0l80,80A8,8,0,0,1,213.66,165.66Z',
  down: 'M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z',
  warning: 'M236.8,188.09,149.35,36.22h0a24.76,24.76,0,0,0-42.7,0L19.2,188.09a23.51,23.51,0,0,0,0,23.72A24.35,24.35,0,0,0,40.55,224h174.9a24.35,24.35,0,0,0,21.33-12.19A23.51,23.51,0,0,0,236.8,188.09ZM120,104a8,8,0,0,1,16,0v40a8,8,0,0,1-16,0Zm8,88a12,12,0,1,1,12-12A12,12,0,0,1,128,192Z',
  lock: 'M208,80H176V56a48,48,0,0,0-96,0V80H48A16,16,0,0,0,32,96V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V96A16,16,0,0,0,208,80ZM96,56a32,32,0,0,1,64,0V80H96ZM208,208H48V96H208V208Zm-68-56a12,12,0,1,1-12-12A12,12,0,0,1,140,152Z',
  minus: 'M216,128a8,8,0,0,1-8,8H48a8,8,0,0,1,0-16H208A8,8,0,0,1,216,128Z',
  back: 'M224,128a8,8,0,0,1-8,8H59.31l58.35,58.34a8,8,0,0,1-11.32,11.32l-72-72a8,8,0,0,1,0-11.32l72-72a8,8,0,0,1,11.32,11.32L59.31,120H216A8,8,0,0,1,224,128Z',
  copy: 'M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z',
  signout: 'M112,216a8,8,0,0,1-8,8H48a16,16,0,0,1-16-16V48A16,16,0,0,1,48,32h56a8,8,0,0,1,0,16H48V208h56A8,8,0,0,1,112,216Zm109.66-93.66-40-40a8,8,0,0,0-11.32,11.32L196.69,120H104a8,8,0,0,0,0,16h92.69l-26.35,26.34a8,8,0,0,0,11.32,11.32l40-40A8,8,0,0,0,221.66,122.34Z',
}

export type IconName = keyof typeof P

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 256 256"
      fill="currentColor" style={{ display: 'block', flex: 'none' }} aria-hidden="true"
    >
      <path d={P[name]} />
    </svg>
  )
}

/** A shop or a person, by what the household called it. */
export function KindIcon({ kind, size = 15 }: { kind: 'SHOP' | 'PERSON'; size?: number }) {
  return <Icon name={kind === 'SHOP' ? 'shop' : 'person'} size={size} />
}

/** An "i" that opens an explanation, rather than a paragraph nobody reads. */
export function InfoButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="iconbtn tap" onClick={onClick} aria-label={label} style={{ margin: '-12px -12px -12px 0' }}>
      <Icon name="info" size={19} />
    </button>
  )
}

export function Empty({ children, bare = false }: { children: ReactNode; bare?: boolean }) {
  return <p className={`empty${bare ? ' empty--bare' : ''}`} role="status">{children}</p>
}
