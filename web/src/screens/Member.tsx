import { useEffect, useMemo, useState } from 'react'
import { api, type MemberState } from '../api'
import { TopBar } from '../App'

type SendState =
  | { kind: 'idle' }
  | { kind: 'sending' | 'asking' }
  | { kind: 'sent'; txHash?: string }
  | { kind: 'asked' }
  | { kind: 'error'; message: string }

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

  const spendable = me ? Number(me.spendable) : 0
  const amt = Number(amount || '0')
  const overCap = me?.hasAllowance ? amt > spendable && amt > 0 : false
  const resetsText = useMemo(() => {
    if (!me?.resetsAt) return ''
    const d = new Date(me.resetsAt * 1000)
    return `resets ${d.toLocaleDateString(undefined, { weekday: 'long' })}`
  }, [me?.resetsAt])

  if (!me) return <div className="center" style={{ paddingTop: 80 }}><span className="spinner" /></div>

  const submit = async () => {
    setState({ kind: overCap ? 'asking' : 'sending' })
    try {
      const r = await api.post<{ kind: 'spent' | 'asked'; txHash?: string }>('/api/spend', { to, amount })
      setState(r.kind === 'spent' ? { kind: 'sent', txHash: r.txHash } : { kind: 'asked' })
      setAmount('')
      load()
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : 'Something went wrong.' })
    }
  }

  const busy = state.kind === 'sending' || state.kind === 'asking'

  return (
    <div>
      <TopBar who={me.name} onLogout={onLogout} />

      <div className="card center">
        <h2>You can spend</h2>
        <div className="big-number num">
          {me.hasAllowance ? me.spendable : '—'}
          <span className="cur">{me.symbol}</span>
        </div>
        {me.hasAllowance
          ? <div className="hint">{me.caps ? `up to ${me.caps.perTx} per purchase · ` : ''}{resetsText}</div>
          : <div className="hint">Your spending is turned off right now — ask a parent.</div>}
      </div>

      {me.hasAllowance && (
        <div className="card">
          <h2>Pay someone</h2>
          <div className="chips">
            {me.merchants.map((m) => (
              <button key={m.address} className={`chip ${to === m.address ? 'on' : ''}`} onClick={() => setTo(m.address)}>
                {m.name}
              </button>
            ))}
          </div>
          <label>Amount ({me.symbol})</label>
          <input
            className="amount-input num"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.]/g, '')); if (state.kind !== 'idle') setState({ kind: 'idle' }) }}
          />
          {/* The button IS the product: over the cap it doesn't disable, it becomes an Ask. */}
          <button className={overCap ? 'ask' : 'primary'} onClick={submit} disabled={busy || !to || amt <= 0}>
            {state.kind === 'sending' && <><span className="spinner" />Sending…</>}
            {state.kind === 'asking' && <><span className="spinner" />Asking…</>}
            {!busy && (overCap ? `Ask a parent for ${amount}` : 'Send')}
          </button>
          {overCap && <div className="hint center" style={{ marginTop: 8 }}>That's over your limit — a parent can approve it.</div>}
          {state.kind === 'sent' && (
            <div className="note ok">
              Sent. It left the family pot and reached them in one transaction — no gas, no waiting on anyone.
              {state.txHash && <> <a className="txlink" href={`https://sepolia.etherscan.io/tx/${state.txHash}`} target="_blank" rel="noreferrer">receipt ↗</a></>}
            </div>
          )}
          {state.kind === 'asked' && <div className="note wait">Asked. A parent will see it right away.</div>}
          {state.kind === 'error' && <div className="note err">{state.message}</div>}
        </div>
      )}

      {me.myRequests.length > 0 && (
        <div className="card">
          <h2>Your asks</h2>
          {me.myRequests.map((r) => (
            <div className="row" key={r.requestId}>
              <div>
                <div className="name num">{r.amount} {me.symbol}</div>
                <div className="meta">to {r.toName}</div>
              </div>
              <span className={`pill ${r.status === 'approved' ? 'ok' : r.status === 'pending' ? 'wait' : 'off'}`}>
                {r.status === 'pending' ? 'asked' : r.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
