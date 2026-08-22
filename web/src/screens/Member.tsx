import { useEffect, useState } from 'react'
import { api, type MemberState } from '../api'
import { TopBar } from '../App'

type SendState =
  | { kind: 'idle' }
  | { kind: 'sending' | 'asking' }
  | { kind: 'sent'; txHash?: string }
  | { kind: 'asked' }
  | { kind: 'error'; message: string }

/**
 * The member's whole app is one question: who are you paying, and how much.
 *
 * There is no pot here and no balance. A kid should not be told how much money
 * the household has — the payload from /api/me doesn't even contain it. All
 * they need to know is whether this particular payment goes through or turns
 * into an ask, and the button answers that as they type.
 */
export default function Member({ onLogout }: { onLogout: () => void }) {
  const [me, setMe] = useState<MemberState | null>(null)
  const [amount, setAmount] = useState('')
  const [to, setTo] = useState('')
  const [state, setState] = useState<SendState>({ kind: 'idle' })

  const load = () => api.get<MemberState>('/api/me').then(setMe).catch(() => {})
  useEffect(() => {
    load()
    const t = setInterval(load, 12_000)
    return () => clearInterval(t)
  }, [])

  if (!me) return <div className="center" style={{ paddingTop: 80 }}><span className="spinner" /></div>

  const amt = Number(amount || '0')
  const headroom = Number(me.headroom)
  const overLimit = me.hasAllowance && amt > 0 && amt > headroom
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

  if (!me.hasAllowance) {
    return (
      <div>
        <TopBar who={me.name} onLogout={onLogout} />
        <div className="card center pad">
          <div className="big-emoji">🔒</div>
          <h2 className="plain">Nothing to spend yet</h2>
          <p className="hint">Ask a parent to set you up. It takes them a second.</p>
        </div>
        <History items={me.activity} symbol={me.symbol} />
      </div>
    )
  }

  return (
    <div>
      <TopBar who={me.name} onLogout={onLogout} />

      <h1 className="pay-title">Pay someone</h1>
      {me.limit && <p className="sub">Up to {me.limit} {me.symbol} at a time. Anything more, a parent says yes first.</p>}

      <div className="card">
        <div className="chips">
          {me.merchants.map((m) => (
            <button key={m.address} className={`chip ${to === m.address ? 'on' : ''}`} onClick={() => setTo(m.address)}>
              {m.name}
            </button>
          ))}
        </div>

        <div className="amount-wrap">
          <input
            className="amount-input num"
            inputMode="decimal"
            placeholder="0"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value.replace(/[^0-9.]/g, ''))
              if (state.kind !== 'idle') setState({ kind: 'idle' })
            }}
          />
          <span className="amount-cur">{me.symbol}</span>
        </div>

        {/* The button is the product: over the limit it doesn't disable, it
            changes what it does. */}
        <button className={overLimit ? 'ask' : 'primary'} onClick={submit} disabled={busy || !ready}>
          {state.kind === 'sending' && <><span className="spinner" />Paying…</>}
          {state.kind === 'asking' && <><span className="spinner" />Asking…</>}
          {!busy && (overLimit
            ? `Ask to pay ${amount}`
            : ready ? `Pay ${merchant?.name ?? 'them'}` : 'Pay')}
        </button>

        {overLimit && <div className="hint center mt8">That's over your limit — this becomes a request.</div>}

        {state.kind === 'sent' && (
          <div className="note ok">
            Paid. {state.txHash && (
              <a className="txlink" href={`https://sepolia.etherscan.io/tx/${state.txHash}`} target="_blank" rel="noreferrer">see it ↗</a>
            )}
          </div>
        )}
        {state.kind === 'asked' && <div className="note wait">Asked. You'll see it here when they answer.</div>}
        {state.kind === 'error' && <div className="note err">{state.message}</div>}
      </div>

      <History items={me.activity} symbol={me.symbol} pending={me.myRequests.filter((r) => r.status === 'pending')} />
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
    <div className="card">
      <h2>Your activity</h2>
      {pending.map((r) => (
        <div className="row" key={r.requestId}>
          <div>
            <div className="name num">{r.amount} {symbol}</div>
            <div className="meta">to {r.toName}</div>
          </div>
          <span className="pill wait">waiting</span>
        </div>
      ))}
      {items.map((a) => (
        <div className="row" key={a.id}>
          <div>
            <div className="name">{a.text}</div>
            <div className="meta">{new Date(a.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
          </div>
          {a.txHash && (
            <a className="txlink" href={`https://sepolia.etherscan.io/tx/${a.txHash}`} target="_blank" rel="noreferrer">↗</a>
          )}
        </div>
      ))}
    </div>
  )
}
