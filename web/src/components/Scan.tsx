import { useEffect, useRef, useState } from 'react'
import { useDialog } from './useDialog'

/**
 * Scanning a code at the till.
 *
 * This is a real camera, not a mime of one. `BarcodeDetector` does the reading
 * where the browser has it — Chrome and Edge do, Safari and Firefox do not —
 * which is why the scan button is hidden rather than disabled on a phone that
 * can't: an affordance that opens a camera and then admits it can't read
 * anything is worse than no affordance.
 */
export function scanningSupported(): boolean {
  return typeof window !== 'undefined'
    && 'BarcodeDetector' in window
    && Boolean(navigator.mediaDevices?.getUserMedia)
}

/**
 * Pull an address out of whatever the code contained.
 *
 * Wallets encode payment requests several ways. A bare address is the common
 * case; EIP-681 (`ethereum:0x…@84532/transfer?address=0x…`) is the correct
 * one, and its `address` parameter wins when present because in a transfer
 * request the recipient is the parameter, not the subject.
 */
function addressFromCode(text: string): string | null {
  const param = text.match(/[?&]address=(0x[0-9a-fA-F]{40})/)
  if (param) return param[1]
  const bare = text.match(/(0x[0-9a-fA-F]{40})/)
  return bare ? bare[1] : null
}

export function Scan({ onFound, onCancel }: { onFound: (address: string) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [problem, setProblem] = useState<string | null>(null)
  // It covers the whole screen, so it has to behave like a dialog: without a
  // trap, the action-bar button beneath it stayed reachable by keyboard and a
  // payment could be committed with the camera still up.
  const panel = useDialog<HTMLDivElement>(true, onCancel)

  // `onFound` is an inline arrow at the call site, so it changes identity on
  // every render of the screen. Held in a ref, the camera is opened once
  // rather than torn down and reopened by each poll of the parent.
  const found = useRef(onFound)
  found.current = onFound

  useEffect(() => {
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false

    ;(async () => {
      try {
        // The rear camera, since the code is on someone else's screen.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
        })
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return }
        if (video.current) {
          video.current.srcObject = stream
          await video.current.play().catch(() => {})
        }

        const Detector = (window as unknown as {
          BarcodeDetector: new (o: { formats: string[] }) => { detect(s: CanvasImageSource): Promise<Array<{ rawValue: string }>> }
        }).BarcodeDetector
        const detector = new Detector({ formats: ['qr_code'] })

        const tick = async () => {
          if (stopped || !video.current) return
          try {
            const codes = await detector.detect(video.current)
            for (const code of codes) {
              const address = addressFromCode(code.rawValue)
              if (address) { found.current(address); return }
            }
          } catch { /* a frame that couldn't be read; the next one will do */ }
          // Ten times a second. Barcode detection is multi-millisecond image
          // work, and at frame rate it pins a phone's CPU for a job nobody can
          // tell apart from this.
          timer = setTimeout(() => { void tick() }, 100)
        }
        void tick()
      } catch (e) {
        if (stopped) return
        setProblem(
          (e as Error)?.name === 'NotAllowedError'
            ? 'The camera is blocked for this site. Type the address instead.'
            : "This phone won't open its camera here. Type the address instead.",
        )
      }
    })()

    return () => {
      stopped = true
      clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return (
    <div
      className="veil veil--over"
      role="dialog"
      aria-modal="true"
      aria-label="Scan a code to pay"
      ref={panel}
      tabIndex={-1}
    >
      <div className="scan__head">
        <div className="kicker kicker--accent">Scan to pay</div>
        <button className="link tap" style={{ color: 'var(--pale)' }} onClick={onCancel}>Cancel</button>
      </div>

      <div className="scan">
        <div className="scan__box">
          <video ref={video} muted playsInline />
          <div className="scan__corner scan__corner--tl" />
          <div className="scan__corner scan__corner--tr" />
          <div className="scan__corner scan__corner--bl" />
          <div className="scan__corner scan__corner--br" />
          {!problem && <div className="scan__line" />}
        </div>
      </div>

      <p className="scan__foot">
        {problem ?? 'Point the camera at the code on the till.'}
      </p>
    </div>
  )
}
