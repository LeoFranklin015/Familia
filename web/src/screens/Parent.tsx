import { useEffect, useState } from 'react'
import { api, type ParentState } from '../api'
import { TopBar } from '../App'

type Tab = 'wallet' | 'family' | 'activity'

export default function Parent({ onLogout }: { onLogout: () => void }) {
  const [st, setSt] = useState<ParentState | null>(null)
  const [tab, setTab] = useState<Tab>('wallet')
  const [note, setNote] = useState<{ kind: 'ok' | 'err' | 'wait'; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = () => api.get<ParentState>('/api/state').then(setSt).catch(() => {})
  useEffect(() => {
    load()
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [])

  if (!st) return <div className="center" style={{ paddingTop: 80 }}><span className="spinner" /></div>

  const run = async (key: string, fn: () => Promise<unknown>, okText: string) => {
    setBusy(key)
    setNote({ kind: 'wait', text: 'Sending — a few seconds.' })
    try {
      await fn()
      setNote({ kind: 'ok', text: okText })
      await load()
    } catch (e) {
      setNote({ kind: 'err', text: e instanceof Error ? e.message : 'Something went wrong.' })
    } finally {
      setBusy(null)
    }
  }

  const verdict = (rid: string, v: 'approve' | 'deny') =>
    run(`req:${rid}`, () => api.post(`/api/requests/${rid}/${v}`),
      v === 'approve' ? 'Approved and paid.' : 'Declined.')

  return (
    <div>
      <TopBar who={st.familyName} onLogout={onLogout} />

      {/* Asks jump the queue regardless of tab — someone is waiting on them. */}
      {st.pendingRequests.map((r) => (
        <div className="card ask-card" key={r.requestId}>
          <h2>{r.memberName} is asking</h2>
          <div className="row">
            <div>
              <div className="big-inline num">{r.amount} <span className="cur">{st.symbol}</span></div>
              <div className="meta">to {r.toName}</div>
            </div>
            <div className="btn-pair">
              <button className="mini go" disabled={busy !== null} onClick={() => verdict(r.requestId, 'approve')}>
                {busy === `req:${r.requestId}` ? '…' : 'Approve'}
              </button>
              <button className="mini danger" disabled={busy !== null} onClick={() => verdict(r.requestId, 'deny')}>
                Decline
              </button>
            </div>
          </div>
        </div>
      ))}

      <div className="tabs">
        {(['wallet', 'family', 'activity'] as Tab[]).map((t) => (
          <button key={t} className={`tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
            {t === 'wallet' ? 'Pot' : t === 'family' ? 'Family' : 'Activity'}
          </button>
        ))}
      </div>

      {tab === 'wallet' && <Wallet st={st} busy={busy} run={run} />}
      {tab === 'family' && <Family st={st} busy={busy} run={run} />}
      {tab === 'activity' && <ActivityList st={st} />}

      {note && <div className={`note ${note.kind}`}>{note.text}</div>}
    </div>
  )
}

function Wallet({ st, busy, run }: {
  st: ParentState
  busy: string | null
  run: (k: string, fn: () => Promise<unknown>, ok: string) => Promise<void>
}) {
  const [amount, setAmount] = useState('')
  const committed = st.members
    .filter((m) => !m.revoked && m.caps)
    .reduce((sum, m) => sum + Number(m.caps!.period), 0)

  return (
    <>
      <div className="card center">
        <h2>The pot</h2>
        <div className="big-number num">{st.wallet.pot}<span className="cur">{st.symbol}</span></div>
        <div className="hint">
          Held in your own account, not ours. Only you can see this.
        </div>
        <label className="left">Add money</label>
        <input className="num" inputMode="decimal" placeholder="500" value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
        <button className="primary" disabled={busy !== null || !Number(amount)}
          onClick={() => run('deposit', () => api.post('/api/deposit', { amount }),
            `Added ${amount} ${st.symbol} to the pot.`).then(() => setAmount(''))}>
          {busy === 'deposit' ? <><span className="spinner" />Adding…</> : 'Add to pot'}
        </button>
      </div>

      <div className="card">
        <h2>Committed to the family</h2>
        <div className="row">
          <div className="meta">Promised in weekly limits</div>
          <div className="num">{committed} {st.symbol}</div>
        </div>
        <div className="row">
          <div className="meta">Your account</div>
          <code className="addr">{st.wallet.address.slice(0, 10)}…{st.wallet.address.slice(-8)}</code>
        </div>
        <p className="hint mt8">
          The spend manager is approved for exactly the total above — never more, never
          unlimited. It goes back down the moment you turn someone off.
        </p>
      </div>
    </>
  )
}

function Family({ st, busy, run }: {
  st: ParentState
  busy: string | null
  run: (k: string, fn: () => Promise<unknown>, ok: string) => Promise<void>
}) {
  const [openFor, setOpenFor] = useState<string | null>(null)
  const [perTx, setPerTx] = useState('50')
  const [period, setPeriod] = useState('120')
  const [inviteName, setInviteName] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [inviteBusy, setInviteBusy] = useState(false)

  const invite = async () => {
    setInviteBusy(true)
    try {
      const r = await api.post<{ joinPath: string }>('/api/invites', { name: inviteName })
      setInviteLink(`${location.origin}${r.joinPath}`)
      setInviteName('')
    } finally { setInviteBusy(false) }
  }

  return (
    <>
      {st.members.map((m) => (
        <div className="card" key={m.id}>
          <div className="row">
            <div>
              <div className="name">{m.name}</div>
              <div className="meta">
                {m.scopeId && !m.revoked
                  ? <>can spend <b className="num">{m.spendable}</b> right now · used <span className="num">{m.spentThisPeriod}</span> this week</>
                  : m.revoked ? 'spending is off' : 'no limits set yet'}
              </div>
            </div>
            <div className="right">
              {m.scopeId && !m.revoked && <span className="pill ok">on</span>}
              {m.revoked && <span className="pill off">off</span>}
            </div>
          </div>

          {m.scopeId && !m.revoked && m.caps && (
            <div className="caps">
              <span className="cap">{m.caps.perTx} {st.symbol} per purchase</span>
              <span className="cap">{m.caps.period} {st.symbol} per week</span>
            </div>
          )}

          {/* The permission id returned by grant(). It is the on-chain handle
              for this person's limits — worth showing, because it is the thing
              that actually enforces them. */}
          {m.scopeId && (
            <details className="perm">
              <summary>Permission on-chain</summary>
              <code className="hash">{m.scopeId}</code>
            </details>
          )}

          <div className="btn-pair mt8">
            {(!m.scopeId || m.revoked) && (
              <button className="mini go" disabled={busy !== null}
                onClick={() => setOpenFor(openFor === m.id ? null : m.id)}>
                Set limits
              </button>
            )}
            {m.scopeId && !m.revoked && (
              <>
                <button className="mini" disabled={busy !== null}
                  onClick={() => setOpenFor(openFor === m.id ? null : m.id)}>Change</button>
                <button className="mini danger" disabled={busy !== null}
                  onClick={() => run(`revoke:${m.id}`, () => api.post(`/api/members/${m.id}/revoke`),
                    `${m.name} can't spend any more.`)}>
                  {busy === `revoke:${m.id}` ? '…' : 'Turn off'}
                </button>
              </>
            )}
          </div>

          {openFor === m.id && (
            <div className="mt8">
              <label>Each purchase, at most ({st.symbol})</label>
              <input className="num" inputMode="decimal" value={perTx} onChange={(e) => setPerTx(e.target.value)} />
              <label>Each week, at most ({st.symbol})</label>
              <input className="num" inputMode="decimal" value={period} onChange={(e) => setPeriod(e.target.value)} />
              <button className="primary" disabled={busy !== null}
                onClick={() => run(`grant:${m.id}`,
                  () => api.post(`/api/members/${m.id}/grant`, { perTx, period, periodLengthDays: 7 }),
                  `${m.name} can spend up to ${perTx} at a time.`).then(() => setOpenFor(null))}>
                {busy === `grant:${m.id}` ? <><span className="spinner" />Setting…</> : 'Save limits'}
              </button>
            </div>
          )}
        </div>
      ))}

      <div className="card">
        <h2>Add someone</h2>
        <p className="hint">They tap the link once. No app, nothing to fund, nothing to remember.</p>
        <input type="text" placeholder="Their name" value={inviteName}
          onChange={(e) => setInviteName(e.target.value)} />
        <button className="primary" disabled={inviteBusy || !inviteName} onClick={invite}>
          {inviteBusy ? <><span className="spinner" />Making link…</> : 'Create invite link'}
        </button>
        {inviteLink && (
          <>
            <div className="linkbox">{inviteLink}</div>
            <button className="mini wide" onClick={() => navigator.clipboard?.writeText(inviteLink)}>Copy link</button>
          </>
        )}
      </div>
    </>
  )
}

function ActivityList({ st }: { st: ParentState }) {
  if (st.activity.length === 0) {
    return <div className="card center pad"><p className="hint">Nothing has happened yet.</p></div>
  }
  return (
    <div className="card">
      {st.activity.map((a) => (
        <div className="row" key={a.id}>
          <div>
            <div className="name">{a.text}</div>
            <div className="meta">
              {new Date(a.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </div>
          </div>
          {a.txHash && (
            <a className="txlink" href={`https://sepolia.basescan.org/tx/${a.txHash}`} target="_blank" rel="noreferrer">↗</a>
          )}
        </div>
      ))}
    </div>
  )
}
