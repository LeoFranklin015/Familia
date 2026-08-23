import { useEffect, useRef, type ReactNode } from 'react'

/**
 * A bottom sheet — the phone-native way to ask for a few fields without
 * navigating away.
 *
 * Handles what a sheet has to handle to be usable rather than merely present:
 * focus moves in on open and back to the opener on close, Escape dismisses,
 * Tab is trapped inside, and the page behind doesn't scroll away underneath.
 */
export function Sheet({
  open, title, onClose, children, hideClose = false, head, back,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  /** For work that cannot be cancelled — offering a way out would be a lie. */
  hideClose?: boolean
  /** Content before the title, e.g. the avatar on a person's sheet. */
  head?: ReactNode
  /** Say "Back" instead of "Close" when this sheet came from another. */
  back?: boolean
}) {
  const panel = useRef<HTMLDivElement>(null)
  const opener = useRef<Element | null>(null)

  // Callers pass an inline arrow, so `onClose` is a new function on every
  // render of the screen. Keeping it in a ref is what stops the effect below
  // re-running on each of the parent's ten-second polls — which re-focused the
  // first control and moved the caret mid-typing.
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    if (!open) return
    opener.current = document.activeElement

    // The sheet scrolls; the page behind it must not.
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'

    const focusables = () =>
      Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => !el.hasAttribute('disabled'))

    // Focus the panel itself, not the first control: on a phone, focusing an
    // input raises the keyboard over the sheet before it has been read.
    panel.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); if (!hideClose) close.current(); return }
      if (e.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      ;(opener.current as HTMLElement | null)?.focus?.()
    }
  }, [open, hideClose])

  if (!open) return null

  return (
    <div className="veil" onClick={hideClose ? undefined : (e) => { if (e.target === e.currentTarget) onClose() }}>
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
          {!hideClose && (
            <button className="link tap" onClick={onClose}>{back ? 'Back' : 'Close'}</button>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}
