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
  open, title, onClose, children, hideClose = false,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  /** For work that cannot be cancelled — offering a way out would be a lie. */
  hideClose?: boolean
}) {
  const panel = useRef<HTMLDivElement>(null)
  const opener = useRef<Element | null>(null)

  useEffect(() => {
    if (!open) return
    opener.current = document.activeElement

    // The sheet scrolls; the page behind it must not.
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'

    // Focus the first control, or the panel itself if there isn't one.
    const focusables = () =>
      Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => !el.hasAttribute('disabled'))
    ;(focusables()[0] ?? panel.current)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); if (!hideClose) onClose(); return }
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
  }, [open, onClose, hideClose])

  if (!open) return null

  return (
    <>
      <div className="sheet-backdrop" onClick={hideClose ? undefined : onClose} aria-hidden="true" />
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panel}
        tabIndex={-1}
      >
        <div className="sheet__grab" aria-hidden="true" />
        <div className="sheet__head">
          <h2>{title}</h2>
          {!hideClose && <button className="link" onClick={onClose}>Cancel</button>}
        </div>
        {children}
      </div>
    </>
  )
}
