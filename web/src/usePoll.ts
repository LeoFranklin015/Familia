import { useEffect } from 'react'

/**
 * Re-read while someone is looking.
 *
 * Both screens poll every ten seconds, and each poll costs a handful of RPC
 * reads. A backgrounded tab has nobody to show them to, so it stops — and
 * fetches once on the way back, since whatever it last drew is now stale.
 */
export function usePoll(load: () => void, everyMs = 10_000) {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined

    const start = () => {
      if (timer) return
      timer = setInterval(load, everyMs)
    }
    const stop = () => {
      clearInterval(timer)
      timer = undefined
    }

    const onVisibility = () => {
      if (document.hidden) { stop(); return }
      load()
      start()
    }

    load()
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [load, everyMs])
}
