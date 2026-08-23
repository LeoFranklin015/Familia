import type { ReactNode } from 'react'
import { useDialog } from './useDialog'

/**
 * A bottom sheet — the phone-native way to ask for a few fields without
 * navigating away.
 *
 * The focus handling comes from `useDialog`, which the other three overlays
 * already use. This file had its own copy: the same trap, but testing only the
 * two boundary elements, so Shift+Tab as the first keystroke escaped to the
 * page behind and never came back.
 */
export function Sheet({
  open, title, onClose, children, head, back,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  /** Content before the title, e.g. the avatar on a person's sheet. */
  head?: ReactNode
  /** Say "Back" instead of "Close" when this sheet came from another. */
  back?: boolean
}) {
  const panel = useDialog<HTMLDivElement>(open, onClose)
  if (!open) return null

  return (
    <div
      className="veil"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panel}
        tabIndex={-1}
      >
        <div className="sheet__grab" aria-hidden="true" />
        <div className={`sheet__head${head ? ' sheet__head--person' : ''}`}>
          {head}
          <div className="sheet__title">{title}</div>
          <button className="link tap" onClick={onClose}>{back ? 'Back' : 'Close'}</button>
        </div>
        {children}
      </div>
    </div>
  )
}
