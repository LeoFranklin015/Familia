import { useEffect, useState } from 'react'
import { api, type ParentState } from '../api'
import { TopBar } from '../App'

export default function Parent({ onLogout }: { onLogout: () => void }) {
  const [st, setSt] = useState<ParentState | null>(null)
  const [note, setNote] = useState<{ kind: 'ok' | 'err' | 'wait'; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [depositAmt, setDepositAmt] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [grantFor, setGrantFor] = useState<string | null>(null)
  const [perTx, setPerTx] = useState('50')
  const [period, setPeriod] = useState('120')

  const load = () => api.get<ParentState>('/api/state').then(setSt).catch(() => {})
  useEffect(() => {
    load()
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [])

  if (!st) return <div className="center" style={{ paddingTop: 80 }}><span className="spinner" /></div>

  const run = async (key: string, fn: () => Promise<unknown>, okText: string) => {
    setBusy(key)
    setNote({ kind: 'wait', text: 'Signing and sending — a few seconds…' })
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

  const deposit = () =>
    run('deposit', () => api.post('/api/deposit', { amount: depositAmt }), `Added ${depositAmt} ${st.symbol} to the pot — it's in Aave now.`)
      .then(() => setDepositAmt(''))

  const invite = async () => {
    setBusy('invite')
    try {
      const r = await api.post<{ joinPath: string }>('/api/invites', { name: inviteName })
      setInviteLink(`${location.origin}${r.joinPath}`)
      setInviteName('')
    } catch (e) {
      setNote({ kind: 'err', text: e instanceof Error ? e.message : 'Could not create the invite.' })
    } finally {
      setBusy(null)
    }
  }

  const grant = (id: string, name: string) =>
    run(`grant:${id}`, () => api.post(`/api/members/${id}/grant`, { perTx, period, periodLengthDays: 7 }),
      `${name} can now spend up to ${perTx} ${st.symbol} at a time, ${period} a week.`)
      .then(() => setGrantFor(null))

  const revoke = (id: string, name: string) =>
    run(`revoke:${id}`, () => api.post(`/api/members/${id}/revoke`), `${name}'s spending is off. It ends on-chain, not just here.`)

  const verdict = (rid: string, v: 'approve' | 'deny') =>
    run(`req:${rid}`, () => api.post(`/api/requests/${rid}/${v}`), v === 'approve' ? 'Approved and paid.' : 'Denied.')

  return (
    <div>
      <TopBar who={st.familyName} onLogout={onLogout} />

      {st.pendingRequests.map((r) => (
        <div className="card" key={r.requestId} style={{ borderColor: '#e8dcbc' }}>
          <h2>Ask from {r.memberName}</h2>
          <div className="row">
            <div>
              <div className="name num">{r.amount} {st.symbol}</div>
              <div className="meta">to {r.toName}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="mini go" disabled={busy !== null} onClick={() => verdict(r.requestId, 'approve')}>
                {busy === `req:${r.requestId}` ? '…' : 'Approve'}
              </button>
              <button className="mini danger" disabled={busy !== null} onClick={() => verdict(r.requestId, 'deny')}>Deny</button>
            </div>
          </div>
        </div>
      ))}

      <div className="card center">
        <h2>Family pot</h2>
        <div className="big-number num">{st.pool}<span className="cur">{st.symbol}</span></div>
        <div className="hint">Sitting in Aave, spendable by the family the moment they need it.</div>
        <label style={{ textAlign: 'left' }}>Add to the pot</label>
        <input className="num" inputMode="decimal" placeholder="500" value={depositAmt}
          onChange={(e) => setDepositAmt(e.target.value.replace(/[^0-9.]/g, ''))} />
        <button className="primary" disabled={busy !== null || !Number(depositAmt)} onClick={deposit}>
          {busy === 'deposit' ? <><span className="spinner" />Depositing…</> : 'Deposit'}
        </button>
      </div>

      <div className="card">
        <h2>Family</h2>
        {st.members.length === 0 && <div className="meta">No members yet — send an invite below.</div>}
        {st.members.map((m) => (
          <div key={m.id}>
            <div className="row">
              <div>
                <div className="name">{m.name}</div>
                <div className="meta">
                  {m.scopeId && !m.revoked
                    ? <>spent <span className="num">{m.spentThisPeriod}</span> · can spend <span className="num">{m.spendable}</span> now</>
                    : m.revoked ? 'spending off' : 'no allowance yet'}
                </div>
              </div>
              <div className="right">
                {m.scopeId && !m.revoked && <span className="pill ok">active</span>}
                {m.revoked && <span className="pill off">off</span>}
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  {(!m.scopeId || m.revoked) && (
                    <button className="mini go" disabled={busy !== null} onClick={() => setGrantFor(grantFor === m.id ? null : m.id)}>
                      Set limits
                    </button>
                  )}
                  {m.scopeId && !m.revoked && (
                    <button className="mini danger" disabled={busy !== null} onClick={() => revoke(m.id, m.name)}>
                      {busy === `revoke:${m.id}` ? '…' : 'Turn off'}
                    </button>
                  )}
                </div>
              </div>
            </div>
            {grantFor === m.id && (
              <div style={{ padding: '4px 0 14px' }}>
                <label>Per purchase ({st.symbol})</label>
                <input className="num" inputMode="decimal" value={perTx} onChange={(e) => setPerTx(e.target.value)} />
                <label>Per week ({st.symbol})</label>
                <input className="num" inputMode="decimal" value={period} onChange={(e) => setPeriod(e.target.value)} />
                <button className="primary" disabled={busy !== null} onClick={() => grant(m.id, m.name)}>
                  {busy === `grant:${m.id}` ? <><span className="spinner" />Setting limits…</> : 'Give allowance'}
                </button>
              </div>
            )}
          </div>
        ))}
        <label>Invite someone</label>
        <input type="text" placeholder="Their name" value={inviteName} onChange={(e) => setInviteName(e.target.value)} />
        <button className="primary" disabled={busy !== null || !inviteName} onClick={invite}>Create invite link</button>
        {inviteLink && <div className="linkbox">{inviteLink}</div>}
      </div>

      {note && <div className={`note ${note.kind}`}>{note.text}</div>}
    </div>
  )
}
