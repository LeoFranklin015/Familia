import { useEffect, useRef } from 'react'

/**
 * Make a dialog behave like one.
 *
 * Focus moves in on open and back to the opener on close, Tab is trapped
 * inside, and Escape dismisses when there is something to dismiss to. Without
 * this, `role="dialog" aria-modal="true"` is a claim the page doesn't honour —
 * focus stays behind the scrim and a keyboard can reach straight through it.
 *
 * The trap tests "focus has left the panel" rather than the two boundary
 * nodes: Shift+Tab as the very first keystroke matches neither boundary, and
 * once focus escapes, neither ever matches again.
 */
export function useDialog<T extends HTMLElement>(
  open: boolean,
  onEscape?: () => void,
): React.RefObject<T> {
  const panel = useRef<T>(null)
  const opener = useRef<Element | null>(null)
  const escape = useRef(onEscape)
  escape.current = onEscape

  useEffect(() => {
    if (!open) return
    opener.current = document.activeElement

    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    panel.current?.focus()

    const items = () => Array.from(
      panel.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    )

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (escape.current) { e.preventDefault(); escape.current() } return }
      if (e.key !== 'Tab') return
      const list = items()
      if (list.length === 0) { e.preventDefault(); panel.current?.focus(); return }
      const first = list[0]
      const last = list[list.length - 1]
      const inside = panel.current?.contains(document.activeElement)
      if (!inside) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      ;(opener.current as HTMLElement | null)?.focus?.()
    }
  }, [open])

  return panel
}
