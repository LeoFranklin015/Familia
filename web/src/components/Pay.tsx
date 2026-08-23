import { Icon, KindIcon } from './ui'
import type { Recipient } from '../api'

/**
 * Who to pay.
 *
 * An address field first, saved names second — the order matters. Naming a
 * shop is a convenience the household added; an address is the thing the
 * chain actually understands, and a wallet that hides it isn't a wallet.
 *
 * When what's typed resolves to a name the household knows, the name is shown
 * back with a tick. That is the only defence against a mistyped address there
 * is, because a payment cannot be called back.
 */
export function To({
  value, onChange, onScan, recipients, problem, canScan,
}: {
  value: string
  onChange: (v: string) => void
  onScan: () => void
  recipients: Recipient[]
  /** Why this address won't work — malformed, or off the allowlist. */
  problem?: string
  canScan: boolean
}) {
  const known = match(recipients, value)
  return (
    <>
      <div className="to">
        <div className="to__box">
          <input
            className="to__input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="0x… or paste an address"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            inputMode="text"
            aria-label="Address to pay"
          />
          {value && (
            <button className="to__clear tap" onClick={() => onChange('')} aria-label="Clear the address">
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
        {canScan && (
          <button className="to__scan tap" onClick={onScan} aria-label="Scan a QR code">
            <Icon name="qr" size={22} />
          </button>
        )}
      </div>

      {known && (
        <div className="to__resolved">
          <Icon name="check" size={14} />
          <span>{known.name}</span>
        </div>
      )}
      {!known && problem && <div className="to__problem">{problem}</div>}
    </>
  )
}

export function Saved({
  recipients, value, onPick,
}: {
  recipients: Recipient[]
  value: string
  onPick: (address: string) => void
}) {
  if (recipients.length === 0) return null
  return (
    <div className="pills">
      {recipients.map((r) => (
        <button
          key={r.id}
          className="pill tap"
          aria-pressed={same(r.address, value)}
          onClick={() => onPick(r.address)}
        >
          <KindIcon kind={r.kind} />
          <span>{r.name}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * How much.
 *
 * Its own keypad rather than the system one: a payment amount is the only
 * thing being typed, the glyph set is eleven keys wide, and a phone keyboard
 * covering the bottom half of a payment screen hides the very thing being
 * confirmed. Two decimals maximum, one decimal point, no leading zeros.
 */
export function Amount({
  value, onChange, symbol, tone = 'normal',
}: {
  value: string
  onChange: (v: string) => void
  symbol: string
  /** `over` when this amount will become a request rather than a payment. */
  tone?: 'normal' | 'over'
}) {
  const press = (k: string) => {
    if (k === '.') return onChange(value.includes('.') ? value : value === '' ? '0.' : `${value}.`)
    const [, decimals] = value.split('.')
    if (decimals !== undefined && decimals.length >= 2) return
    onChange(value === '0' ? k : value + k)
  }

  const empty = value === ''
  return (
    <div className="panel mt4">
      <div className="tile__label">How much</div>
      <div
        className={`amount mt1${empty ? ' amount--empty' : tone === 'over' ? ' amount--over' : ''}`}
        role="status"
        aria-live="polite"
        aria-label={`${empty ? '0' : value} ${symbol}`}
      >
        <span className="amount__unit">{symbol}</span>
        <span className="amount__value">{empty ? '0.00' : value}</span>
      </div>

      <div className="keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0'].map((k) => (
          <button key={k} className="key tap" onClick={() => press(k)}>{k}</button>
        ))}
        <button
          className="key key--del tap"
          onClick={() => onChange(value.slice(0, -1))}
          aria-label="Delete the last digit"
        >
          <Icon name="back" size={22} />
        </button>
      </div>
    </div>
  )
}

export function match(recipients: Recipient[], address: string): Recipient | null {
  const t = address.trim().toLowerCase()
  if (!t) return null
  return recipients.find((r) => r.address.toLowerCase() === t) ?? null
}

export function same(a: string, b: string): boolean {
  return Boolean(a) && a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** Good enough to submit. The chain does the real checking; this only decides
 *  whether the button is live. */
export function looksLikeAddress(a: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(a.trim())
}

/** A name if the household has one, otherwise the address, shortened. */
export function label(recipients: Recipient[], address: string): string {
  const r = match(recipients, address)
  if (r) return r.name
  const t = address.trim()
  return t.length > 14 ? `${t.slice(0, 6)}…${t.slice(-4)}` : t
}
