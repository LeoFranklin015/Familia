import type { ReactNode } from 'react'
import { Mark } from './ui'

/**
 * On a phone this is a passthrough. On a desktop it puts the app inside a
 * handset-sized frame, because the app is designed for a thumb and looks wrong
 * stretched across a monitor.
 *
 * Nothing inside positions against the window: each screen is the containing
 * block for its own tab bar, action bar and sheets, so they stay inside the
 * handset here and inside the viewport on a phone without either case being a
 * special one.
 */
export function Device({ children }: { children: ReactNode }) {
  return (
    <div className="stage">
      <div className="device">
        <div className="device__island" aria-hidden="true" />
        <div className="device__screen">{children}</div>
      </div>

      {/* Desktop-only aside. It says what the app is and why it is boxed into
          a handset, and nothing else: an address to retype is not something a
          person needs on the screen they are already looking at. */}
      <aside className="stage__aside">
        <div className="stage__mark"><Mark size={40} /></div>
        <p className="stage__brand">Familia</p>
        <p className="stage__line">One wallet the whole house runs on.</p>
        <p className="stage__hint">Built for a thumb, so it is shown at that size.</p>
      </aside>
    </div>
  )
}
