import { useState } from 'react'
import { api, type ParentState } from '../api'
import { Amount, label, looksLikeAddress, Saved, To } from '../components/Pay'
import { Scan, scanningSupported } from '../components/Scan'
import { Icon, two } from '../components/ui'
import type { Act } from './Parent'

/**
 * The guardian paying someone directly.
 *
 * No limits apply here — they are the funder, and the money is theirs. The
 * only ceiling is the balance itself, which Aave enforces, so the button stays
 * live and the refusal comes back in words rather than being pre-empted by a
 * disabled control.
 *
 * The allowlist doesn't apply either: it binds spenders, and a funder isn't
 * one. Worth knowing when reading this next to the member's version, which
 * looks the same and behaves differently.
 */
export function PayTab({ st, act }: { st: ParentState; act: Act }) {
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [scan, setScan] = useState(false)

  const value = Number(amount || '0')
  const ready = looksLikeAddress(to) && value > 0
  const overBalance = value > Number(st.wallet.pot)
  const name = label(st.recipients, to)

  const pay = () => act({
    title: `Pay ${two(amount)} to ${name}`,
    steps: ['Take it out of Aave', `Send it to ${name}`],
    quote: { action: 'pay', to: to.trim(), amount },
    call: (auth) => api.post('/api/pay', { to: to.trim(), amount, auth }),
  })

  return (
    <>
      <div className="scroll"><div className="page page--action">
        <div className="kicker" style={{ padding: '0 8px 14px' }}>{st.familyName} household</div>

        <div className="tile" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <span
            className="avatar avatar--sm"
            style={{ background: 'var(--accent-fill)', color: 'var(--accent)', borderColor: 'transparent' }}
          >
            <Icon name="pay" size={17} />
          </span>
          <div className="num" style={{ fontSize: 12.5, color: 'var(--muted)' }}>
            From the household balance · {two(st.wallet.pot)} {st.symbol}
          </div>
        </div>

        <div className="kicker kicker--muted sec__pad">To</div>
        <To
          value={to}
          onChange={setTo}
          onScan={() => setScan(true)}
          recipients={st.recipients}
          canScan={scanningSupported()}
          problem={to.trim() && !looksLikeAddress(to) ? "That doesn't look like an address yet." : undefined}
        />

        {st.recipients.length > 0 && (
          <>
            <div className="kicker kicker--muted" style={{ padding: '20px 8px 10px' }}>Saved</div>
            <Saved recipients={st.recipients} value={to} onPick={setTo} />
          </>
        )}

        <Amount value={amount} onChange={setAmount} symbol={st.symbol} tone={overBalance ? 'over' : 'normal'} />
      </div></div>

      <div className="actionbar">
        {overBalance && (
          <p className="actionbar__hint">
            More than the household balance — Aave will refuse it.
          </p>
        )}
        <button className="btn tap" disabled={!ready} onClick={pay}>
          {!looksLikeAddress(to) ? 'Enter an address'
            : value <= 0 ? 'Enter an amount'
            : `Pay ${two(amount)} to ${name}`}
        </button>
      </div>

      {scan && (
        <Scan
          onCancel={() => setScan(false)}
          onFound={(a) => { setTo(a); setScan(false) }}
        />
      )}
    </>
  )
}
