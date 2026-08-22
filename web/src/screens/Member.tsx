import { useEffect, useRef, useState } from 'react'
import { api, type MemberState } from '../api'
import { TopBar } from '../App'
import { Empty, Icon, Money, ScreenSkeleton } from '../components/ui'

type SendState =
  | { kind: 'idle' }
  | { kind: 'sending' | 'asking' }
  | { kind: 'sent'; txHash?: string }
  | { kind: 'asked' }
  | { kind: 'error'; message: string }

/**
 * The member's whole app is one question: who are you paying, and how much.
 *
 * There is no pot here and no balance — a child should not be told how much
 * money the household has, and `/api/me` doesn't even contain it. What they
 * need to know is whether this particular payment goes through or turns into a
 * request, and the button answers that as they type.
 *
 * The amount is the interface, and the action sits at the bottom of the screen
 * where a thumb already is.
 */
export default function Member({ onLogout }: { onLogout: () => void }) {
  const [me, setMe] = useState<MemberState | null>(null)
  const [amount, setAmount] = useState('')
  const [to, setTo] = useState('')
  const [state, setState] = useState<SendState>({ kind: 'idle' })
  const amountRef = useRef<HTMLInputElement>(null)

  const load = () => api.get<MemberState>('/api/me').then(setMe).catch(() => {})
  useEffect(() => {
    load()
    const t = setInterval(load, 12_000)
    return () => clearInterval(t)
  }, [])

  if (!me) {
    return (
      <div className="app">
        <TopBar who="" onLogout={onLogout} />
        <ScreenSkeleton label="Loading your account" />
      </div>
    )
  }

  if (!me.hasAllowance) {
    return (
      <div className="app">
        <TopBar who={me.name} onLogout={onLogout} />
        <Empty icon={<Icon.lock />} title="Nothing to spend yet">
          Ask a parent to set you up. It takes them a second.
        </Empty>
        <History items={me.activity} symbol={me.symbol} />
      </div>
    )
  }

  const amt = Number(amount || '0')
  const overLimit = amt > 0 && amt > Number(me.headroom)
  const merchant = me.merchants.find((m) => m.address === to)
  const busy = state.kind === 'sending' || state.kind === 'asking'
  const ready = Boolean(to) && amt > 0

  const submit = async () => {
    setState({ kind: overLimit ? 'asking' : 'sending' })
    try {
      const r = await api.post<{ kind: 'spent' | 'asked'; txHash?: string }>('/api/spend', { to, amount })
      setState(r.kind === 'spent' ? { kind: 'sent', txHash: r.txHash } : { kind: 'asked' })
      setAmount('')
      load()
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : 'Something went wrong.' })
    }
  }

  return (
    <div className="app app--acting">
      <TopBar who={me.name} onLogout={onLogout} />

      <h1>Pay someone</h1>
      {me.limit && (
        <p className="lede mt2">
          Up to {me.limit} {me.symbol} at a time. More than that and a parent says yes first.
        </p>
      )}

      <div className="card mt4">
        <h2 id="who">Who</h2>
        <div className="chips" role="group" aria-labelledby="who">
          {me.merchants.map((m) => (
            <button
              key={m.address}
              type="button"
              className="chip"
              aria-pressed={to === m.address}
              onClick={() => { setTo(m.address); amountRef.current?.focus() }}
            >
              {m.name}
            </button>
          ))}
        </div>

        <label htmlFor="amount" className="sr-only">Amount in {me.symbol}</label>
        <div className="amount">
          <input
            id="amount"
            ref={amountRef}
            className="num"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            placeholder="0"
            size={4}
            value={amount}
            onChange={(e) => {
              // One leading figure set, one optional decimal part.
              const cleaned = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')
              setAmount(cleaned)
              if (state.kind !== 'idle') setState({ kind: 'idle' })
            }}
            style={{ width: `${Math.max(1, amount.length || 1)}ch` }}
          />
          <span className="amount__unit">{me.symbol}</span>
        </div>

        {overLimit && (
          <p className="hint" style={{ textAlign: 'center' }}>
            Over your limit — this becomes a request.
          </p>
        )}

        {/* Live region: the outcome is announced, not just shown. */}
        <div role="status" aria-live="polite">
          {state.kind === 'sent' && (
            <div className="note note--ok">
              Paid.{' '}
              {state.txHash && (
                <a className="txlink" href={`https://sepolia.basescan.org/tx/${state.txHash}`} target="_blank" rel="noreferrer">
                  see it ↗
                </a>
              )}
            </div>
          )}
          {state.kind === 'asked' && <div className="note note--wait">Asked. You'll see it here when they answer.</div>}
          {state.kind === 'error' && <div className="note note--err">{state.message}</div>}
        </div>
      </div>

      <History items={me.activity} symbol={me.symbol} pending={me.myRequests.filter((r) => r.status === 'pending')} />

      {/* The action lives in the thumb zone, above the home indicator. Over the
          limit it doesn't disable — it changes what it does. */}
      <div className="actionbar">
        <div className="actionbar__inner">
          <button
            className={`btn btn--block ${overLimit ? 'btn--ask' : 'btn--primary'}`}
            onClick={submit}
            disabled={busy || !ready}
          >
            {busy && <span className="spinner" />}
            {state.kind === 'sending' && 'Paying…'}
            {state.kind === 'asking' && 'Asking…'}
            {!busy && (overLimit
              ? `Ask to pay ${amount}`
              : ready ? `Pay ${merchant?.name ?? 'them'}` : 'Pay')}
          </button>
        </div>
      </div>
    </div>
  )
}

function History({
  items, symbol, pending = [],
}: {
  items: MemberState['activity']
  symbol: string
  pending?: MemberState['myRequests']
}) {
  if (items.length === 0 && pending.length === 0) return null
  return (
    <section className="card">
      <h2>Your activity</h2>
      <ul role="list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {pending.map((r) => (
          <li className="row" key={r.requestId}>
            <div className="row__main">
              <Money value={r.amount} unit={symbol} size="sm" />
              <div className="meta">to {r.toName}</div>
            </div>
            <span className="pill pill--wait">waiting</span>
          </li>
        ))}
        {items.map((a) => (
          <li className="row" key={a.id}>
            <div className="row__main">
              <div className="row__title">{a.text}</div>
              <div className="meta">
                {new Date(a.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </div>
            </div>
            {a.txHash && (
              <a className="txlink" href={`https://sepolia.basescan.org/tx/${a.txHash}`} target="_blank" rel="noreferrer"
                 aria-label="View this payment on the block explorer">↗</a>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
