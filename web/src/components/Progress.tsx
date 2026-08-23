import { Sheet } from './Sheet'

/**
 * What a transaction looks like while it happens.
 *
 * On-chain operations take fifteen to thirty seconds, which is far too long
 * for a button spinner and long enough that a person will assume it failed.
 * So the work gets its own surface: what is happening, that it is still
 * happening, and — once it lands — the amount, the fee and the receipt.
 *
 * It is deliberately not dismissible while running. Nothing is cancellable at
 * that point, so offering a way out would only be a lie.
 */
export type Job =
  | { state: 'running'; title: string; note?: string }
  | { state: 'done'; title: string; note?: string; fee?: string | null; symbol?: string; txHash?: string }
  | { state: 'failed'; title: string; reason: string }

export function Progress({ job, onClose }: { job: Job | null; onClose: () => void }) {
  if (!job) return null
  const running = job.state === 'running'

  return (
    <Sheet
      open
      title={job.title}
      onClose={running ? () => {} : onClose}
      hideClose={running}
    >
      <div className="job">
        <div className={`job__mark job__mark--${job.state}`} aria-hidden="true">
          {running && <span className="spinner" />}
          {job.state === 'done' && (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4.5 12.5 10 18 20 6.5" />
            </svg>
          )}
          {job.state === 'failed' && (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M12 7v7M12 17.4v.2" />
            </svg>
          )}
        </div>

        <p className="job__line" role="status" aria-live="polite">
          {job.state === 'running' && (job.note ?? 'Working on it.')}
          {job.state === 'done' && (job.note ?? 'Done.')}
          {job.state === 'failed' && job.reason}
        </p>

        {job.state === 'running' && (
          <p className="hint">This takes a few seconds. You can leave it open.</p>
        )}

        {job.state === 'done' && job.fee && (
          <dl className="dl mt4">
            <div className="dl__row">
              <dt>Network fee</dt>
              <dd>{job.fee} {job.symbol}</dd>
            </div>
          </dl>
        )}

        {job.state === 'done' && job.txHash && (
          <a className="btn btn--quiet btn--block mt4" href={`https://sepolia.basescan.org/tx/${job.txHash}`}
             target="_blank" rel="noreferrer">
            View receipt
          </a>
        )}

        {!running && (
          <button className="btn btn--primary btn--block mt2" onClick={onClose}>Done</button>
        )}
      </div>
    </Sheet>
  )
}
