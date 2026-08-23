import { Icon } from './ui'

/**
 * The last thing between an intention and the chain.
 *
 * Every write in this app authorises itself — sessions hold no key, so a
 * signature is re-derived from the person's face at the moment they act. That
 * makes this sheet the honest place to name two things: what is about to
 * happen, and what it will cost at most.
 *
 * "At most" matters. The paymaster quotes a ceiling and charges the real cost
 * afterwards, so promising an exact figure here would be a small lie that the
 * receipt would then contradict.
 */
export type Pending = {
  /** What is about to happen, in the person's own terms. */
  title: string
  /** The quoted ceiling, already formatted, or null while it is being fetched. */
  fee: string | null
  symbol: string
  /** Members never pay — say so rather than showing a zero. */
  covered?: boolean
  /** Why this cannot go through at all. Not a quoting failure. */
  blocked?: string
  run: () => void
}

export function Confirm({
  pending, onCancel, onPassphrase,
}: {
  pending: Pending | null
  onCancel: () => void
  onPassphrase?: () => void
}) {
  if (!pending) return null
  const { title, fee, symbol, covered, blocked } = pending

  return (
    <div className="veil veil--auth" onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet__grab" aria-hidden="true" />
        <div className="kicker kicker--accent">Confirm it's you</div>
        <div className="sheet__title mt2" style={{ marginBottom: 14 }}>{title}</div>

        <dl className="dl">
          <div className="dl__row dl__row--edge">
            <dt>{covered ? 'Fee' : 'Fee, at most'}</dt>
            <dd>
              {covered ? "Nothing — it's covered"
                : fee ? `${fee} ${symbol}`
                : <span className="skel" style={{ display: 'inline-block', width: 78, height: 14 }} />}
            </dd>
          </div>
        </dl>

        {blocked && (
          <div className="callout mt3">
            <Icon name="warning" size={18} />
            <p className="note" style={{ color: 'var(--warn)' }}>{blocked}</p>
          </div>
        )}

        <button className="btn tap mt4" onClick={pending.run} disabled={Boolean(blocked)}>
          <Icon name="face" size={19} />
          Use Face ID
        </button>
        <div style={{ display: 'flex', gap: 18, marginTop: 8 }}>
          <button className="link link--muted tap" onClick={onCancel}>Cancel</button>
          {onPassphrase && (
            <button className="link tap" onClick={onPassphrase} disabled={Boolean(blocked)}>
              Use a passphrase
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
