import type { ReactNode } from 'react'
import { Sheet } from './Sheet'
import { Icon } from './ui'

/**
 * Who you are, top right, on every screen.
 *
 * A phone app puts the account behind your own initial in the corner, and
 * everything about the account — including leaving — lives behind it. Sign-out
 * was previously buried in a fees sheet on one side and at the bottom of a
 * scroll on the other, which is two wrong places for the same thing.
 */
export function AccountButton({ initial, onOpen }: { initial: string; onOpen: () => void }) {
  return (
    <button
      className="accountbtn tap"
      onClick={onOpen}
      aria-label="Your account"
    >
      {initial.toUpperCase()}
    </button>
  )
}

export function AccountSheet({
  open, onClose, name, role, children, onSignOut,
}: {
  open: boolean
  onClose: () => void
  name: string
  /** One line under the name: the household, and which side of it you are on. */
  role: string
  /** Whatever else belongs to the account on this side. */
  children?: ReactNode
  onSignOut: () => void
}) {
  return (
    <Sheet open={open} title="Account" onClose={onClose}>
      <div className="accountid">
        <span className="avatar avatar--lg" style={{ width: 48, height: 48, fontSize: 18 }}>
          {name[0]?.toUpperCase()}
        </span>
        <div className="row__body">
          <div className="accountid__name">{name}</div>
          <div className="accountid__role">{role}</div>
        </div>
      </div>

      {children}

      <button className="btn btn--quiet tap mt4" onClick={onSignOut}>
        <Icon name="signout" size={17} />
        Sign out
      </button>
      <p className="note mt2" style={{ textAlign: 'center' }}>
        Your account stays. Only this device is signed out.
      </p>
    </Sheet>
  )
}
