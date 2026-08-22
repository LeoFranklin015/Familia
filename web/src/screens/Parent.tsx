import { useEffect, useState } from 'react'
import { api, type FeeQuote, type ParentState } from '../api'
import { approve, knownCredentialId, NeedsPassphrase, post, type Approval } from '../auth'
import { TopBar } from '../App'
import { Sheet } from '../components/Sheet'
import { Empty, Icon, Money, ScreenSkeleton } from '../components/ui'

type Tab = 'pot' | 'family' | 'activity'

export default function Parent({ onLogout }: { onLogout: () => void }) {
  const [st, setSt] = useState<ParentState | null>(null)
  const [tab, setTab] = useState<Tab>('pot')
  const [note, setNote] = useState<{ kind: 'ok' | 'err' | 'wait'; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // A write blocked on a passphrase, held until the sheet answers.
  const [pending, setPending] = useState<{ key: string; ok: string; call: (a: Approval) => Promise<unknown> } | null>(null)
  const [passphrase, setPassphrase] = useState('')

  const load = () => api.get<ParentState>('/api/state').then(setSt).catch(() => {})
  useEffect(() => {
    load()
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [])

  if (!st) {
    return (
      <div className="app">
        <TopBar who="" onLogout={onLogout} />
        <ScreenSkeleton label="Loading your family" />
      </div>
    )
  }

  /**
   * Every parent write asks for the key at the moment it happens. These are the
   * operations with no on-chain ceiling behind them — approving a request
   * deliberately bypasses the caps — so the person is the only guard, and they
   * should be asked each time rather than once an hour.
   */
  const run = async (key: string, call: (auth: Approval) => Promise<unknown>, okText: string, auth?: Approval) => {
    let approval = auth
    if (!approval) {
      try {
        approval = await approve()
      } catch (e) {
        if (e instanceof NeedsPassphrase) { setPending({ key, ok: okText, call }); return }
        setNote({ kind: 'err', text: 'Approval was cancelled.' })
        return
      }
    }
    setBusy(key)
    setNote({ kind: 'wait', text: 'Sending — a few seconds.' })
    try {
      const res = (await call(approval)) as { feeCharged?: string | null } | undefined
      const charged = res?.feeCharged
      setNote({ kind: 'ok', text: charged ? `${okText} Network fee: ${charged} ${st.symbol}.` : okText })
      await load()
    } catch (e) {
      setNote({ kind: 'err', text: e instanceof Error ? e.message : 'Something went wrong.' })
    } finally {
      setBusy(null)
    }
  }

  const runWithPassphrase = () => {
    const credentialId = knownCredentialId()
    const job = pending
    setPending(null)
    const pass = passphrase
    setPassphrase('')
    if (!credentialId || !job) { setNote({ kind: 'err', text: 'No account on this device.' }); return }
    run(job.key, job.call, job.ok, { credentialId, passphrase: pass })
  }

  const verdict = (rid: string, v: 'approve' | 'deny') =>
    run(`req:${rid}`, (auth) => post(`/api/requests/${rid}/${v}`, {}, auth),
      v === 'approve' ? 'Approved and paid.' : 'Declined.')

  const asks = st.pendingRequests

  return (
    <div className="app app--tabbed">
      <TopBar who={st.familyName} onLogout={onLogout} />

      {/* Someone is waiting on these, so they sit above whatever tab you're on. */}
      {asks.map((r) => (
        <section className="card card--attention" key={r.requestId}>
          <h2>{r.memberName} is asking</h2>
          <div className="row">
            <div className="row__main">
              <Money value={r.amount} unit={st.symbol} size="sm" />
              <div className="meta">to {r.toName}</div>
            </div>
            <div className="btn-pair">
              <button className="btn btn--sm btn--go" disabled={busy !== null} onClick={() => verdict(r.requestId, 'approve')}>
                {busy === `req:${r.requestId}` ? <span className="spinner" /> : 'Approve'}
              </button>
              <button className="btn btn--sm btn--danger" disabled={busy !== null} onClick={() => verdict(r.requestId, 'deny')}>
                Decline
              </button>
            </div>
          </div>
        </section>
      ))}

      {st.wallet.setup.status === 'running' && (
        <div className="note note--wait" role="status">
          <span className="spinner" />Getting your account ready — this happens once.
        </div>
      )}
      {st.wallet.setup.status === 'failed' && (
        <div className="note note--err" role="alert">Setup didn't finish: {st.wallet.setup.reason} Reload to retry.</div>
      )}

      {tab === 'pot' && <Pot st={st} busy={busy} run={run} />}
      {tab === 'family' && <Family st={st} busy={busy} run={run} />}
      {tab === 'activity' && <Activity st={st} />}

      {note && (
        <div className={`note note--${note.kind}`} role="status" aria-live="polite">
          {note.kind === 'wait' && <span className="spinner" />}{note.text}
        </div>
      )}

      <Sheet open={Boolean(pending)} title="Confirm it's you" onClose={() => setPending(null)}>
        <p className="hint">This device can't use Face ID, so your passphrase approves this.</p>
        <label htmlFor="pp">Your passphrase</label>
        <input id="pp" type="password" value={passphrase} autoFocus enterKeyHint="go"
          onChange={(e) => setPassphrase(e.target.value)} />
        <button className="btn btn--primary btn--block mt4" disabled={passphrase.length < 8} onClick={runWithPassphrase}>
          Approve
        </button>
      </Sheet>

      <nav className="tabbar" role="tablist" aria-label="Sections">
        {([
          ['pot', 'Pot', <Icon.pot key="p" />],
          ['family', 'Family', <Icon.family key="f" />],
          ['activity', 'Activity', <Icon.activity key="a" />],
        ] as const).map(([id, label, icon]) => (
          <button key={id} role="tab" aria-selected={tab === id} className="tab" onClick={() => setTab(id as Tab)}>
            {icon}
            {label}
            {id === 'family' && asks.length > 0 && <span className="tab__badge" aria-label={`${asks.length} waiting`} />}
          </button>
        ))}
      </nav>
    </div>
  )
}

type RunFn = (k: string, call: (auth: Approval) => Promise<unknown>, ok: string) => Promise<void>

/**
 * The fee for an operation, quoted in USD₮ before it's signed.
 *
 * The figure comes from WDK quoting the exact batch that would be sent, so
 * what's shown is what will be charged. Debounced, because it re-quotes as the
 * amount is typed.
 */
function useFeeQuote(body: Record<string, unknown> | null) {
  const [quote, setQuote] = useState<FeeQuote | null>(null)
  const key = body ? JSON.stringify(body) : null

  useEffect(() => {
    if (!key) { setQuote(null); return }
    let live = true
    const t = setTimeout(() => {
      api.post<FeeQuote>('/api/quote', JSON.parse(key))
        .then((q) => { if (live) setQuote(q) })
        .catch(() => { if (live) setQuote(null) })
    }, 400)
    return () => { live = false; clearTimeout(t) }
  }, [key])

  return quote
}

function Fee({ quote, symbol }: { quote: FeeQuote | null; symbol: string }) {
  if (!quote) return null
  if (quote.blocked) return <div className="fee fee--warn"><div className="fee__main">{quote.blocked}</div></div>
  if (quote.feeMode === 'sponsored') {
    return <div className="fee"><div className="fee__main">Network fee <b>free</b><span className="fee__aside">your first one is on us</span></div></div>
  }
  if (quote.fee == null) {
    return <div className="fee fee--warn"><div className="fee__main">Couldn't work out the fee just now.</div></div>
  }
  // "Up to", because a quote is a ceiling — max gas at max fee — while the
  // paymaster charges the actual cost once the operation has run.
  return (
    <div className="fee">
      <div className="fee__main">
        Network fee <b className="num">up to {quote.fee} {symbol}</b>
        <span className="fee__aside">in {symbol}, not ETH — you pay the actual cost</span>
      </div>
      {quote.steps && quote.steps.length > 0 && (
        <ol className="fee__steps">{quote.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
      )}
    </div>
  )
}

function Pot({ st, busy, run }: { st: ParentState; busy: string | null; run: RunFn }) {
  const [amount, setAmount] = useState('')
  const quote = useFeeQuote(Number(amount) > 0 ? { action: 'deposit', amount } : null)
  const committed = st.members
    .filter((m) => !m.revoked && m.caps)
    .reduce((sum, m) => sum + Number(m.caps!.period), 0)

  return (
    <>
      <section className="card" style={{ textAlign: 'center' }}>
        <h2>The pot</h2>
        <Money value={st.wallet.pot} unit={st.symbol} />
        <p className="hint mt2">Earning in Aave, in your own account — not ours.</p>

        <div className="row mt4" style={{ textAlign: 'left', borderTop: '1px solid var(--line)', paddingTop: 'var(--s3)' }}>
          <div className="row__main">
            <div className="meta">In your account</div>
            <div className="hint">outside Aave — funds deposits and fees</div>
          </div>
          <div className="num" style={{ fontWeight: 700 }}>{st.wallet.loose} {st.symbol}</div>
        </div>

        <label htmlFor="deposit">Add money</label>
        <input id="deposit" className="num" inputMode="decimal" enterKeyHint="done"
          placeholder="500" value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
        {Number(st.wallet.loose) === 0 && (
          <p className="hint mt2">Nothing in the account to add — the test faucet tops up once a day.</p>
        )}
        <Fee quote={quote} symbol={st.symbol} />
        <button className="btn btn--primary btn--block mt4"
          disabled={busy !== null || !Number(amount)}
          onClick={() => run('deposit', (auth) => post('/api/deposit', { amount }, auth),
            `Added ${amount} ${st.symbol} to the pot.`).then(() => setAmount(''))}>
          {busy === 'deposit' && <span className="spinner" />}
          {busy === 'deposit' ? 'Adding…' : 'Add to pot'}
        </button>
      </section>

      <section className="card">
        <h2>Fees</h2>
        {st.wallet.feeMode === 'usdt' ? (
          <p className="hint" style={{ marginTop: 0 }}>
            You pay your own fees in {st.symbol} — never ETH. A paymaster fronts the
            network's gas and takes {st.symbol} back. Everyone you invite is sponsored:
            they pay nothing, ever, and need no balance to spend.
          </p>
        ) : (
          <p className="hint" style={{ marginTop: 0 }}>
            Your first operation is on us. After it, this account pays its own fees in{' '}
            {st.symbol} — and the family always spends for free.
          </p>
        )}
        <div className="row mt4">
          <div className="meta">Promised in weekly limits</div>
          <div className="num">{committed} {st.symbol}</div>
        </div>
        <div className="row">
          <div className="meta">Your account</div>
          <code className="mono">{st.wallet.address.slice(0, 10)}…{st.wallet.address.slice(-6)}</code>
        </div>
        <p className="hint mt2">
          The spend manager is approved for exactly the total above — never more, never
          unlimited. It drops the moment you turn someone off.
        </p>
      </section>
    </>
  )
}

function Family({ st, busy, run }: { st: ParentState; busy: string | null; run: RunFn }) {
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [inviting, setInviting] = useState(false)
  const [perTx, setPerTx] = useState('50')
  const [period, setPeriod] = useState('120')
  const [inviteName, setInviteName] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [inviteBusy, setInviteBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const quote = useFeeQuote(
    editing && Number(perTx) > 0 && Number(period) > 0
      ? { action: 'grant', memberId: editing.id, perTx, period, periodLengthDays: 7 }
      : null,
  )

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
      {st.members.length === 0 && (
        <Empty icon={<Icon.family />} title="No one yet">
          Invite someone and they'll be set up in one tap.
        </Empty>
      )}

      {st.members.map((m) => (
        <section className="card" key={m.id}>
          <div className="row">
            <div className="row__main">
              <div className="row__title">{m.name}</div>
              <div className="meta">
                {m.scopeId && !m.revoked
                  ? <>can spend <b className="num">{m.spendable}</b> now · used <span className="num">{m.spentThisPeriod}</span> this week</>
                  : m.revoked ? 'spending is off' : 'no limits set yet'}
              </div>
            </div>
            {m.scopeId && !m.revoked && <span className="pill pill--on">on</span>}
            {m.revoked && <span className="pill pill--off">off</span>}
          </div>

          {m.scopeId && !m.revoked && m.caps && (
            <div className="tags">
              <span className="tag">{m.caps.perTx} {st.symbol} per purchase</span>
              <span className="tag">{m.caps.period} {st.symbol} per week</span>
            </div>
          )}

          {/* The permission id grant() returned — the thing that actually
              enforces the limits, rather than the app's memory of them. */}
          {m.scopeId && (
            <details className="perm">
              <summary>Permission on-chain</summary>
              <code className="mono">{m.scopeId}</code>
            </details>
          )}

          <div className="btn-pair mt4">
            <button className="btn btn--sm btn--go" disabled={busy !== null}
              onClick={() => {
                setPerTx(m.caps?.perTx ?? '50')
                setPeriod(m.caps?.period ?? '120')
                setEditing({ id: m.id, name: m.name })
              }}>
              {m.scopeId && !m.revoked ? 'Change limits' : 'Set limits'}
            </button>
            {m.scopeId && !m.revoked && (
              <button className="btn btn--sm btn--danger" disabled={busy !== null}
                onClick={() => run(`revoke:${m.id}`, (auth) => post(`/api/members/${m.id}/revoke`, {}, auth), `${m.name} can't spend any more.`)}>
                {busy === `revoke:${m.id}` ? <span className="spinner" /> : 'Turn off'}
              </button>
            )}
          </div>
        </section>
      ))}

      <button className="btn btn--quiet btn--block" onClick={() => { setInviteLink(''); setCopied(false); setInviting(true) }}>
        Add someone
      </button>

      <Sheet open={Boolean(editing)} title={editing ? `${editing.name}'s limits` : ''} onClose={() => setEditing(null)}>
        <label htmlFor="perTx">Each purchase, at most ({st.symbol})</label>
        <input id="perTx" className="num" inputMode="decimal" value={perTx}
          onChange={(e) => setPerTx(e.target.value.replace(/[^0-9.]/g, ''))} />
        <label htmlFor="perWeek">Each week, at most ({st.symbol})</label>
        <input id="perWeek" className="num" inputMode="decimal" value={period}
          onChange={(e) => setPeriod(e.target.value.replace(/[^0-9.]/g, ''))} />
        <Fee quote={quote} symbol={st.symbol} />
        <button className="btn btn--primary btn--block mt4"
          disabled={busy !== null || !Number(perTx) || !Number(period)}
          onClick={() => {
            const m = editing!
            setEditing(null)
            run(`grant:${m.id}`, (auth) => post(`/api/members/${m.id}/grant`, { perTx, period, periodLengthDays: 7 }, auth),
              `${m.name} can spend up to ${perTx} at a time.`)
          }}>
          Save limits
        </button>
      </Sheet>

      <Sheet open={inviting} title="Add someone" onClose={() => setInviting(false)}>
        <p className="hint">They tap the link once. No app, nothing to fund, nothing to remember.</p>
        {!inviteLink ? (
          <>
            <label htmlFor="inviteName">Their name</label>
            <input id="inviteName" type="text" value={inviteName} enterKeyHint="done"
              onChange={(e) => setInviteName(e.target.value)} />
            <button className="btn btn--primary btn--block mt4" disabled={inviteBusy || !inviteName.trim()} onClick={invite}>
              {inviteBusy && <span className="spinner" />}{inviteBusy ? 'Making link…' : 'Create invite link'}
            </button>
          </>
        ) : (
          <>
            <div className="linkbox mono">{inviteLink}</div>
            <button className="btn btn--primary btn--block mt4"
              onClick={() => { navigator.clipboard?.writeText(inviteLink); setCopied(true) }}>
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <p className="center-row"><button className="link" onClick={() => setInviting(false)}>Done</button></p>
          </>
        )}
      </Sheet>
    </>
  )
}

function Activity({ st }: { st: ParentState }) {
  if (st.activity.length === 0) {
    return <Empty icon={<Icon.receipt />} title="Nothing yet">Deposits, limits and payments show up here.</Empty>
  }
  return (
    <section className="card">
      <ul role="list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {st.activity.map((a) => (
          <li className="row" key={a.id}>
            <div className="row__main">
              <div className="row__title">{a.text}</div>
              <div className="meta">
                {new Date(a.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </div>
            </div>
            {a.txHash && (
              <a className="txlink" href={`https://sepolia.basescan.org/tx/${a.txHash}`} target="_blank" rel="noreferrer"
                 aria-label="View on the block explorer">↗</a>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
