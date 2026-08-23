import type { ReactNode } from 'react'
import { Icon, KindIcon } from './ui'
import { figureSize } from '../lib/money'
import { labelFor, looksLikeAddress, matchRecipient, sameAddress } from '../lib/address'
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
  const known = matchRecipient(recipients, value)
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
          // A choice among several, not a toggle: activating the selected one
          // re-selects it rather than turning it off.
          aria-current={sameAddress(r.address, value) ? 'true' : undefined}
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
 * Step one: who.
 *
 * `context` is whatever the screen wants to say about where the money comes
 * from — a balance, a weekly limit. It stays compact, because it is background
 * for the decision rather than the decision.
 */
export function WhoStep({
  context, value, onChange, onScan, canScan, recipients, problem, onNext, nextLabel, blocked,
}: {
  context?: ReactNode
  value: string
  onChange: (v: string) => void
  onScan: () => void
  canScan: boolean
  recipients: Recipient[]
  problem?: string
  onNext: () => void
  nextLabel: string
  /** Set when the address is real but will be refused — the hint says why. */
  blocked?: boolean
}) {
  const ready = looksLikeAddress(value) && !blocked
  return (
    <>
      <div className="scroll"><div className="page page--action">
        {context}

        <div className="kicker kicker--muted sec__pad">To</div>
        <To
          value={value}
          onChange={onChange}
          onScan={onScan}
          recipients={recipients}
          canScan={canScan}
          problem={problem}
        />

        {recipients.length > 0 && (
          <>
            <div className="kicker kicker--muted" style={{ padding: '20px 8px 10px' }}>Saved</div>
            <Saved recipients={recipients} value={value} onPick={onChange} />
          </>
        )}
      </div></div>

      <div className="actionbar">
        <button className="btn tap" disabled={!ready} onClick={onNext}>
          {looksLikeAddress(value) ? nextLabel : 'Enter an address'}
        </button>
      </div>
    </>
  )
}

/**
 * Step two: how much.
 *
 * Its own screen, and deliberately not scrollable — the figure sits in the
 * middle and the keypad stays put at the bottom. That is the whole reason for
 * splitting the flow: on one long page the keypad ended up below the fold on
 * the screen where the number is the point.
 */
export function AmountStep({
  to, subtitle, onBack, value, onChange, symbol, tone = 'normal', under, action, onMax,
}: {
  /** Who is being paid, already resolved to a name where there is one. */
  to: string
  subtitle?: string
  onBack: () => void
  value: string
  onChange: (v: string) => void
  symbol: string
  tone?: 'normal' | 'over'
  /** One line under the figure: what will happen, or why it won't. */
  under?: string
  action: ReactNode
  /** Offered when there is a definite ceiling worth filling in one tap. */
  onMax?: () => void
}) {
  const empty = value === ''
  return (
    <>
      <div className="amount-screen">
        <div className="step-head">
          <button className="step-head__back tap" onClick={onBack} aria-label="Back">
            <Icon name="back" size={20} />
          </button>
          <div className="step-head__body">
            <div className="step-head__to">{subtitle ?? 'To'}</div>
            <div className="step-head__who">{to}</div>
          </div>
        </div>

        <div className="amount-screen__figure">
          <div
            className={`amount-screen__big${empty ? ' amount-screen__big--empty' : tone === 'over' ? ' amount-screen__big--over' : ''}`}
            role="status"
            aria-live="polite"
            aria-label={`${empty ? '0' : value} ${symbol}`}
          >
            <span className="amount-screen__unit">{symbol}</span>
            <span className="amount-screen__value" style={{ fontSize: figureSize(empty ? '0' : value) }}>
              {empty ? '0' : value}
            </span>
          </div>
          {under && <p className="amount-screen__under">{under}</p>}
          {onMax && <button className="maxchip tap" onClick={onMax}>Use the lot</button>}
        </div>

        <div className="amount-screen__pad">
          <Keypad value={value} onChange={onChange} />
        </div>
      </div>

      <div className="actionbar">{action}</div>
    </>
  )
}

/** Eleven keys and a delete. Two decimals, one point, seven figures. */
export function Keypad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const press = (k: string) => {
    if (k === '.') return onChange(value.includes('.') ? value : value === '' ? '0.' : `${value}.`)
    const [whole, decimals] = value.split('.')
    if (decimals !== undefined && decimals.length >= 2) return
    if (decimals === undefined && whole.replace('-', '').length >= 7) return
    onChange(value === '0' ? k : value + k)
  }
  return (
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
  )
}
