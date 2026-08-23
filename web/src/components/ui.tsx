import type { ReactNode } from 'react'

/** An amount, always tabular so digits don't shift as figures change. */
export function Money({ value, unit, size = 'lg' }: { value: string; unit: string; size?: 'lg' | 'sm' }) {
  return (
    <span className={`money${size === 'sm' ? ' money--sm' : ''}`}>
      <span className="money__figure num">{value}</span>
      <span className="money__unit">{unit}</span>
    </span>
  )
}

/** Content-shaped placeholder. Screens that know their shape shouldn't
 *  collapse to a spinner and then jump. */
export function Skeleton({ h = 16, w = '100%', mt = 0 }: { h?: number; w?: string; mt?: number }) {
  return <div className="skel" style={{ height: h, width: w, marginTop: mt }} aria-hidden="true" />
}

export function ScreenSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label}>
      <div className="card">
        <Skeleton h={12} w="35%" />
        <Skeleton h={44} w="60%" mt={14} />
        <Skeleton h={12} w="80%" mt={14} />
      </div>
      <div className="card">
        <Skeleton h={12} w="30%" />
        <Skeleton h={18} mt={14} />
        <Skeleton h={18} w="70%" mt={10} />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  )
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty" role="status">
      <div className="empty__mark" aria-hidden="true">{icon}</div>
      <h2>{title}</h2>
      {children && <p className="hint mt2">{children}</p>}
    </div>
  )
}

/* Icons — line-drawn, 22px grid, inherit currentColor. Kept in one place so
   stroke weight stays consistent. */
const base = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
}

/** The mark: a bounded shape with the money inside it. Household money,
 *  shared and bounded — drawn rather than lettered, so it survives being
 *  small and doesn't read as a wordmark trope. */
export function Mark({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="38" height="38" rx="13" stroke="currentColor" strokeWidth="2.4" opacity="0.28" />
      <circle cx="22" cy="22" r="8.5" fill="currentColor" />
    </svg>
  )
}

export const Icon = {
  home: () => (
    <svg {...base} aria-hidden="true"><path d="M4 10.6 12 4l8 6.6" /><path d="M6 9.8V19a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9.8" /></svg>
  ),
  family: () => (
    <svg {...base} aria-hidden="true"><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 5.2a3.2 3.2 0 0 1 0 6.1" /><path d="M17.5 14.4A5.5 5.5 0 0 1 20.5 20" /></svg>
  ),
  activity: () => (
    <svg {...base} aria-hidden="true"><path d="M3 12h4l2.5 6 5-14L17 12h4" /></svg>
  ),
  lock: () => (
    <svg {...base} width="22" height="22" aria-hidden="true"><rect x="4.5" y="10" width="15" height="10.5" rx="2.2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
  ),
  chevron: () => (
    <svg {...base} width="18" height="18" className="chev" aria-hidden="true"><path d="m9.5 6 6 6-6 6" /></svg>
  ),
  receipt: () => (
    <svg {...base} width="22" height="22" aria-hidden="true"><path d="M6 3.5h12v17l-2.5-1.6-2.5 1.6-2.5-1.6L8 20.5 6 21Z" /><path d="M9.5 8.5h5M9.5 12.5h5" /></svg>
  ),
}
