import { Icon, KindIcon } from '../../components/ui'
import { shortAddress } from '../../lib/address'
import type { Recipient } from '../../api'

/** A labelled figure in a detail sheet. */
export function Row({ label, value, tone }: { label: string; value: string; tone?: 'accent' }) {
  return (
    <div className="dl__row">
      <dt>{label}</dt>
      <dd style={tone === 'accent' ? { color: 'var(--accent)' } : undefined}>{value}</dd>
    </div>
  )
}

/**
 * A recipient, as the address book and the places sheet both draw them.
 *
 * `onPick` turns the row into a choice; without it the row is a record with
 * an action beside it.
 */
export function RecipientRow({
  recipient, note, picked, onPick, action,
}: {
  recipient: Recipient
  /** Extra context under the address, e.g. who is allowed to pay it. */
  note?: string
  picked?: boolean
  onPick?: () => void
  action?: React.ReactNode
}) {
  const body = (
    <>
      {onPick && <Check on={Boolean(picked)} />}
      <span className="avatar avatar--sm avatar--dim">
        <KindIcon kind={recipient.kind} size={16} />
      </span>
      <span className="row__body">
        <span className="recipient__name">{recipient.name}</span>
        <span className="recipient__addr num">
          {shortAddress(recipient.address)}{note ? ` · ${note}` : ''}
        </span>
      </span>
      {action}
    </>
  )

  return onPick
    ? <button className="recipient tap" onClick={onPick} aria-pressed={picked}>{body}</button>
    : <div className="recipient">{body}</div>
}

/** The rounded check square. Used by anything that is on or off. */
export function Check({ on }: { on: boolean }) {
  return (
    <span className={`check${on ? ' check--on' : ''}`}>
      {on && <Icon name="check" size={13} />}
    </span>
  )
}
