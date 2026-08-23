import { Icon } from './ui'
import { useDialog } from './useDialog'

/**
 * What an on-chain operation looks like while it happens.
 *
 * Fifteen to thirty seconds. That is block time plus a bundler, it cannot be
 * optimised away, and it is far too long for a spinner inside a button — long
 * enough that a person will assume it failed and press again.
 *
 * So the work gets a surface, and the surface is honest about three things:
 * what it is doing (each step lights as it lands), that it is still going, and
 * what it actually cost once it is done — the charge, not the quote.
 *
 * Not dismissible while running. Nothing is cancellable at that point, and a
 * close button that doesn't stop anything is a lie.
 */
export type Op = {
  title: string
  /** Every on-chain call this one operation makes, in order. */
  steps: string[]
  /** How many have landed. */
  done: number
  status: 'running' | 'done' | 'failed'
  /** The ceiling, while running. */
  quote?: string | null
  /** What was actually taken, once it landed. */
  charged?: string | null
  symbol: string
  /** Members pay nothing, ever. */
  covered?: boolean
  txHash?: string
  reason?: string
}

const KICKER = { running: 'Working', done: 'Done', failed: 'Refused' } as const

export function OpModal({ op, onClose }: { op: Op | null; onClose: () => void }) {
  const running = op?.status === 'running'
  // No Escape while it runs: nothing is cancellable at that point.
  const panel = useDialog<HTMLDivElement>(Boolean(op), running ? undefined : onClose)
  if (!op) return null

  return (
    <div className="veil veil--op">
      <div className="modal" role="dialog" aria-modal="true" aria-label={op.title} ref={panel} tabIndex={-1}>
        <div className="kicker kicker--accent">{KICKER[op.status]}</div>
        <div className="sheet__title mt2" style={{ marginBottom: 14 }}>{op.title}</div>

        {running && (
          <div className="opbar" aria-hidden="true"><div className="opbar__fill" /></div>
        )}

        <div className="steps">
          {op.steps.map((label, i) => {
            const landed = i < op.done
            // On a failure everything from the failing step on is marked, not
            // just the one that threw — nothing after it ran either.
            const failed = op.status === 'failed' && i >= op.done
            return (
              <div key={label + i} className={`step${landed ? ' step--done' : ''}${failed ? ' step--failed' : ''}`}>
                {running && i === op.done
                  ? <span className="spin" aria-hidden="true" />
                  : <span className="step__mark" aria-hidden="true" />}
                <span className="step__label">{label}</span>
              </div>
            )
          })}
        </div>

        <dl className="dl" style={{ marginTop: 6 }}>
          <div className="dl__row">
            <dt>{running ? 'Network fee' : 'Fee charged'}</dt>
            <dd>{fee(op)}</dd>
          </div>
        </dl>

        <p className="sr-only" role="status" aria-live="polite">
          {running ? `${op.done} of ${op.steps.length} steps done` : KICKER[op.status]}
        </p>

        {running && (
          <p className="note mt2">
            About twenty seconds. It's the chain, not the phone, so you can watch
            or put it in your pocket.
          </p>
        )}

        {op.status === 'done' && op.txHash && (
          <a
            className="row__tx mt2"
            style={{ fontSize: 11.5, color: 'var(--faint)' }}
            href={`https://sepolia.basescan.org/tx/${op.txHash}`}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="external" size={11} />
            <span className="num">{op.txHash.slice(0, 6)}…{op.txHash.slice(-4)}</span>
          </a>
        )}

        {op.status === 'failed' && <p className="warn mt2">{op.reason}</p>}

        {!running && (
          <button
            className={`btn tap mt4${op.status === 'failed' ? ' btn--quiet' : ''}`}
            onClick={onClose}
          >
            {op.status === 'failed' ? 'Got it' : 'Done'}
          </button>
        )}
      </div>
    </div>
  )
}

function fee(op: Op) {
  if (op.status === 'failed') return 'Nothing'
  if (op.covered) return <span className="badge">Sponsored</span>
  if (op.status === 'running') return op.quote ? `Up to ${op.quote} ${op.symbol}` : '…'
  // No `Charged` event from our paymaster means it took nothing: the
  // operation ended up sponsored. Say so, rather than printing a zero that
  // reads like a measurement.
  return op.charged ? `${op.charged} ${op.symbol}` : <span className="badge">Sponsored</span>
}
