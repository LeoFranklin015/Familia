import type { ReactNode } from 'react'
import { Mark } from './ui'

/**
 * On a phone this is a passthrough. On a desktop it puts the app inside a
 * handset-sized frame, because the app is designed for a thumb and looks wrong
 * stretched across a monitor.
 *
 * The frame carries a `transform` in CSS, which makes it the containing block
 * for its fixed-position descendants — that's what keeps the action bar, tab
 * bar and bottom sheets pinned inside the device instead of escaping to the
 * browser viewport.
 */
export function Device({ children }: { children: ReactNode }) {
  return (
    <div className="stage">
      <div className="device">
        <div className="device__island" aria-hidden="true" />
        <div className="device__screen">{children}</div>
      </div>

      {/* Desktop-only aside: whoever opens this on a laptop should know the
          real thing is a phone, and how to get there. */}
      <aside className="stage__aside">
        <div className="stage__mark"><Mark size={40} /></div>
        <p className="stage__brand">kin</p>
        <p className="stage__line">Pocket money with limits the network enforces.</p>
        <p className="stage__hint">Built for a phone — open this address on yours to use Face ID.</p>
        <p className="stage__url mono">{location.host}</p>
      </aside>
    </div>
  )
}
