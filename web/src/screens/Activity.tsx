import type { Activity as Item } from '../api'
import { Icon } from '../components/ui'
import { when } from '../lib/time'

/**
 * What happened, newest first.
 *
 * Every entry carries intent rather than a decoded transfer — "Maya's spending
 * turned off" is a sentence we can write because we knew what the person was
 * doing. Asks and approvals are contract state rather than token movement, and
 * they come out cleanest of all this way.
 *
 * The dot is the only colour: green when something is still open (an ask
 * waiting, a refusal to read), grey once it has settled.
 */
const OPEN = new Set(['ask', 'denied'])

export function Activity({ items, title }: { items: Item[]; title?: string }) {
  if (items.length === 0 && title) {
    return (
      <div className="page">
        <h2 className="h2" style={{ margin: '0 8px 20px' }}>{title}</h2>
        <p className="empty">
          Nothing yet. Money you add, limits you set and payments the family
          makes all show up here.
        </p>
      </div>
    )
  }

  const rows = (
    <div>
      {items.map((a) => (
        <div className="row" key={a.id}>
          <span className={`row__dot${OPEN.has(a.kind) ? ' row__dot--live' : ''}`} aria-hidden="true" />
          <div className="row__body">
            <div className="row__text">{a.text}</div>
            <div className="row__meta">
              <span>{when(a.at)}</span>
              {a.txHash && (
                <a
                  className="row__tx"
                  href={`https://sepolia.basescan.org/tx/${a.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="See this on the block explorer"
                >
                  <Icon name="external" size={11} />
                  <span className="num">{a.txHash.slice(0, 6)}…{a.txHash.slice(-4)}</span>
                </a>
              )}
            </div>
          </div>
          {a.amount && <div className="row__amount">{a.amount}</div>}
        </div>
      ))}
    </div>
  )

  if (!title) return rows
  return (
    <div className="page">
      <h2 className="h2" style={{ margin: '0 8px 20px' }}>{title}</h2>
      {rows}
    </div>
  )
}

