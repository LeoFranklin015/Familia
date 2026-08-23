import { useState } from 'react'
import { api, type ParentState } from '../api'
import { AmountStep, WhoStep } from '../components/Pay'
import { labelFor, looksLikeAddress } from '../lib/address'
import { Scan, scanningSupported } from '../components/Scan'
import { Icon } from '../components/ui'
import { floor2, two } from '../lib/money'
import type { Act } from './Parent'

/**
 * The guardian paying someone directly.
 *
 * No limits apply — they are the funder, and the money is theirs. The only
 * ceiling is the balance, which Aave enforces, so the button stays live and
 * the refusal comes back in words rather than being pre-empted by a disabled
 * control.
 *
 * The allowlist doesn't apply either: it binds spenders, and a funder isn't
 * one. Worth knowing when reading this beside the member's version, which
 * looks nearly identical and behaves differently.
 */
export function PayTab({ st, act }: { st: ParentState; act: Act }) {
  const [step, setStep] = useState<'who' | 'amount'>('who')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [scan, setScan] = useState(false)

  const value = Number(amount || '0')
  const balance = Number(st.wallet.pot)
  const overBalance = value > balance
  const name = labelFor(st.recipients, to)

  const pay = () => act({
    title: `Pay ${two(amount)} to ${name}`,
    steps: ['Take it out of Aave', `Send it to ${name}`],
    quote: { action: 'pay', to: to.trim(), amount },
    call: async (auth) => {
      const r = await api.post<{ txHash?: string; feeCharged?: string | null }>(
        '/api/pay', { to: to.trim(), amount, auth },
      )
      setAmount(''); setTo(''); setStep('who')
      return r
    },
  })

  return (
    <>
      {step === 'who' ? (
        <WhoStep
          context={
            <>
              <div className="kicker" style={{ padding: '0 8px 14px' }}>{st.familyName} household</div>
              <div className="tile" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <span
                  className="avatar avatar--sm"
                  style={{ background: 'var(--accent-fill)', color: 'var(--accent)', borderColor: 'transparent' }}
                >
                  <Icon name="pay" size={17} />
                </span>
                <span className="row__body">
                  <span className="tile__label" style={{ display: 'block' }}>From the household balance</span>
                  <span className="num" style={{ display: 'block', fontSize: 15, fontWeight: 600, marginTop: 2 }}>
                    {two(st.wallet.pot)} {st.symbol}
                  </span>
                </span>
              </div>
            </>
          }
          value={to}
          onChange={setTo}
          onScan={() => setScan(true)}
          canScan={scanningSupported()}
          recipients={st.recipients}
          problem={to.trim() && !looksLikeAddress(to) ? "That doesn't look like an address yet." : undefined}
          onNext={() => setStep('amount')}
          nextLabel={`Pay ${name}`}
        />
      ) : (
        <AmountStep
          to={name}
          onBack={() => setStep('who')}
          value={amount}
          onChange={setAmount}
          symbol={st.symbol}
          tone={overBalance ? 'over' : 'normal'}
          under={overBalance
            ? `More than the ${floor2(st.wallet.pot)} balance, so Aave will refuse it.`
            : `Household balance · ${floor2(st.wallet.pot)} ${st.symbol}`}
          onMax={balance > 0 ? () => setAmount(floor2(st.wallet.pot)) : undefined}
          action={
            <button className="btn tap" disabled={value <= 0} onClick={pay}>
              {value <= 0 ? 'Enter an amount' : `Pay ${two(amount)} to ${name}`}
            </button>
          }
        />
      )}

      {scan && (
        <Scan
          onCancel={() => setScan(false)}
          onFound={(a) => { setTo(a); setScan(false) }}
        />
      )}
    </>
  )
}
