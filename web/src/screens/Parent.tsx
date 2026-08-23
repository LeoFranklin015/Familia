import { useEffect, useState } from 'react'
import { api, type FeeQuote, type ParentState } from '../api'
import { approve, knownCredentialId, NeedsPassphrase, post, type Approval } from '../auth'
import { TopBar } from '../App'
import { Sheet } from '../components/Sheet'
import { Progress, type Job } from '../components/Progress'
import { Empty, Icon, ScreenSkeleton } from '../components/ui'

type Tab = 'home' | 'family' | 'activity'
type Member = ParentState['members'][number]

/** Explanations live here, behind an (i), so no screen carries a paragraph. */
const NOTES = {
  balance: {
    title: 'Where the money sits',
    body: [
      'The balance is supplied to Aave and held as aUSD₮ in your own account. Nobody takes custody of it — not us, not the app.',
      'When someone spends, their allowance redeems from that position and pays the shop in the same transaction.',
    ],
  },
  fees: {
    title: 'Who pays for what',
    body: [
      'You pay your own network fees in USD₮ — never ETH, and you never hold a native token.',
      'Everyone you invite is sponsored. They pay nothing, ever, and need no balance of any kind to spend.',
    ],
  },
  committed: {
    title: 'Committed to the family',
    body: [
      'The total of everyone’s weekly limits. The spend manager is approved for exactly this amount — never more, and never unlimited.',
      'It drops the moment you turn someone off.',
    ],
  },
} as const

export default function Parent({ onLogout }: { onLogout: () => void }) {
  const [st, setSt] = useState<ParentState | null>(null)
  const [tab, setTab] = useState<Tab>('home')
  const [job, setJob] = useState<Job | null>(null)
  const [note, setNote] = useState<keyof typeof NOTES | null>(null)
  const [pending, setPending] = useState<{ run: (a: Approval) => void } | null>(null)
  const [passphrase, setPassphrase] = useState('')

  const load = () => api.get<ParentState>('/api/state').then(setSt).catch(() => {})
  useEffect(() => {
    load()
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [])

  if (!st) {
    return <div className="app"><TopBar who="" onLogout={onLogout} /><ScreenSkeleton label="Loading" /></div>
  }

  /**
   * Every parent write: approve, then watch it happen in its own surface.
   * These operations have no on-chain ceiling behind them, so the person is
   * the only guard and is asked each time.
   */
  const act = (
    title: string,
    call: (auth: Approval) => Promise<{ feeCharged?: string | null; txHash?: string }>,
    done: string,
    auth?: Approval,
  ) => {
    const go = async (approval: Approval) => {
      setJob({ state: 'running', title, note: 'Signing and sending to the network.' })
      try {
        const res = await call(approval)
        setJob({ state: 'done', title, note: done, fee: res?.feeCharged, symbol: st.symbol, txHash: res?.txHash })
        await load()
      } catch (e) {
        setJob({ state: 'failed', title, reason: e instanceof Error ? e.message : 'Something went wrong.' })
      }
    }
    if (auth) { void go(auth); return }
    approve().then(go).catch((e) => {
      if (e instanceof NeedsPassphrase) { setPending({ run: go }); return }
      setJob({ state: 'failed', title, reason: 'Approval was cancelled.' })
    })
  }

  const withPassphrase = () => {
    const credentialId = knownCredentialId()
    const job = pending
    const pass = passphrase
    setPending(null); setPassphrase('')
    if (credentialId && job) job.run({ credentialId, passphrase: pass })
  }

  const asks = st.pendingRequests
  const funding = st.wallet.setup.status === 'running'

  return (
    <div className="app app--tabbed">
      <TopBar who={st.familyName} onLogout={onLogout} />

      {tab === 'home' && <Home st={st} act={act} onInfo={setNote} />}
      {tab === 'family' && <Family st={st} act={act} onInfo={setNote} />}
      {tab === 'activity' && <Activity st={st} />}

      {/* Funding is a job like any other, so it gets the same surface. */}
      <Progress
        job={funding
          ? { state: 'running', title: 'Setting up your account', note: 'Getting your first USD₮ and turning on fee payments.' }
          : job}
        onClose={() => setJob(null)}
      />

      <Sheet open={Boolean(note)} title={note ? NOTES[note].title : ''} onClose={() => setNote(null)}>
        {note && NOTES[note].body.map((p, i) => <p key={i} className={i ? 'lede mt4' : 'lede'}>{p}</p>)}
        <button className="btn btn--primary btn--block mt4" onClick={() => setNote(null)}>Got it</button>
      </Sheet>

      <Sheet open={Boolean(pending)} title="Confirm it's you" onClose={() => setPending(null)}>
        <p className="hint">This device can't use Face ID, so your passphrase approves it.</p>
        <label htmlFor="pp">Passphrase</label>
        <input id="pp" type="password" value={passphrase} autoFocus enterKeyHint="go"
          onChange={(e) => setPassphrase(e.target.value)} />
        <button className="btn btn--primary btn--block mt4" disabled={passphrase.length < 8} onClick={withPassphrase}>
          Approve
        </button>
      </Sheet>

      <nav className="tabbar" role="tablist" aria-label="Sections">
        {([['home', 'Home', <Icon.home key="p" />], ['family', 'Family', <Icon.family key="f" />], ['activity', 'Activity', <Icon.activity key="a" />]] as const)
          .map(([id, label, icon]) => (
            <button key={id} role="tab" aria-selected={tab === id} className="tab"
              aria-label={label} onClick={() => setTab(id as Tab)}>
              {icon}
              <span className="tab__label">{label}</span>
              {id === 'family' && asks.length > 0 && <span className="tab__badge" aria-label={`${asks.length} waiting`} />}
            </button>
          ))}
      </nav>
    </div>
  )
}

type Act = (
  title: string,
  call: (auth: Approval) => Promise<{ feeCharged?: string | null; txHash?: string }>,
  done: string,
) => void
type OnInfo = (k: keyof typeof NOTES) => void

function useFeeQuote(body: Record<string, unknown> | null) {
  const [quote, setQuote] = useState<FeeQuote | null>(null)
  const key = body ? JSON.stringify(body) : null
  useEffect(() => {
    if (!key) { setQuote(null); return }
    let live = true
    const t = setTimeout(() => {
      api.post<FeeQuote>('/api/quote', JSON.parse(key)).then((q) => { if (live) setQuote(q) }).catch(() => { if (live) setQuote(null) })
    }, 400)
    return () => { live = false; clearTimeout(t) }
  }, [key])
  return quote
}

function Fee({ quote, symbol }: { quote: FeeQuote | null; symbol: string }) {
  if (!quote) return null
  if (quote.blocked) return <div className="fee fee--warn"><div className="fee__main">{quote.blocked}</div></div>
  if (quote.feeMode === 'sponsored') return <div className="fee"><div className="fee__main">Fee <b>free</b><span className="fee__aside">your first one is on us</span></div></div>
  if (quote.fee == null) return <div className="fee fee--warn"><div className="fee__main">Couldn't work out the fee.</div></div>
  // "Up to": a quote is a ceiling, the paymaster charges the real cost.
  return (
    <div className="fee">
      <div className="fee__main">Fee <b className="num">up to {quote.fee} {symbol}</b><span className="fee__aside">in {symbol}, not ETH</span></div>
    </div>
  )
}

function Home({ st, act, onInfo }: { st: ParentState; act: Act; onInfo: OnInfo }) {
  const [adding, setAdding] = useState(false)
  const [amount, setAmount] = useState('')
  const quote = useFeeQuote(adding && Number(amount) > 0 ? { action: 'deposit', amount } : null)
  const committed = st.members.filter((m) => !m.revoked && m.caps).reduce((s, m) => s + Number(m.caps!.period), 0)

  return (
    <>
      {/* Earning, and spent from. The one number this screen is about. */}
      <section className="panel" aria-label="Family balance">
        <div className="panel__label">
          Family balance
          <button className="info" onClick={() => onInfo('balance')} aria-label="Where the money sits">i</button>
        </div>
        <div className="panel__figure num">{st.wallet.pot}<span>{st.symbol}</span></div>
        <div className="panel__note">Earning in Aave · in your own account</div>
      </section>

      {/* A different thing, so a different section: money in the account that
          is not yet earning, and the only place a deposit can come from. */}
      <div className="section"><h2>Available to add</h2></div>
      <div className="tile">
        <div className="tile__figure num">{st.wallet.loose}<span>{st.symbol}</span></div>
        <button className="btn btn--primary" onClick={() => { setAmount(''); setAdding(true) }}
          disabled={Number(st.wallet.loose) === 0}>
          Add money
        </button>
      </div>

      <div className="section">
        <h2>Allowances</h2>
        <button className="info" onClick={() => onInfo('committed')} aria-label="Committed to the family">i</button>
      </div>
      <dl className="dl">
        <div className="dl__row"><dt>Promised each week</dt><dd className="num">{committed} {st.symbol}</dd></div>
        <div className="dl__row"><dt>People spending</dt><dd className="num">{st.members.filter((m) => m.scopeId && !m.revoked).length}</dd></div>
      </dl>

      <div className="section">
        <h2>Account</h2>
        <button className="info" onClick={() => onInfo('fees')} aria-label="Who pays for what">i</button>
      </div>
      <dl className="dl">
        <div className="dl__row"><dt>You pay fees in</dt><dd>{st.wallet.feeMode === 'usdt' ? st.symbol : 'sponsored'}</dd></div>
        <div className="dl__row"><dt>Family spends</dt><dd>free</dd></div>
        <div className="dl__row"><dt>Address</dt><dd className="mono">{st.wallet.address.slice(0, 6)}…{st.wallet.address.slice(-4)}</dd></div>
      </dl>

      <Sheet open={adding} title="Add money" onClose={() => setAdding(false)}>
        <div className="amount">
          <input className="num" inputMode="decimal" enterKeyHint="done" placeholder="0" autoFocus
            value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            style={{ width: `${Math.max(1, amount.length || 1)}ch` }} aria-label={`Amount in ${st.symbol}`} />
          <span className="amount__unit">{st.symbol}</span>
        </div>
        <p className="hint" style={{ textAlign: 'center' }}>{st.wallet.loose} {st.symbol} available</p>
        <Fee quote={quote} symbol={st.symbol} />
        <button className="btn btn--primary btn--block mt4" disabled={!Number(amount)}
          onClick={() => {
            const value = amount
            setAdding(false)
            act('Adding to the balance', (auth) => post('/api/deposit', { amount: value }, auth), `${value} ${st.symbol} is in the balance.`)
          }}>
          Add {amount || ''} {st.symbol}
        </button>
      </Sheet>
    </>
  )
}

function Family({ st, act, onInfo }: { st: ParentState; act: Act; onInfo: OnInfo }) {
  const [open, setOpen] = useState<Member | null>(null)
  const [limits, setLimits] = useState<Member | null>(null)
  const [inviting, setInviting] = useState(false)
  const [perTx, setPerTx] = useState('50')
  const [period, setPeriod] = useState('120')
  const [inviteName, setInviteName] = useState('')
  const [link, setLink] = useState('')
  const [copied, setCopied] = useState(false)

  const quote = useFeeQuote(limits && Number(perTx) > 0 && Number(period) > 0
    ? { action: 'grant', memberId: limits.id, perTx, period, periodLengthDays: 7 } : null)

  const asks = st.pendingRequests

  return (
    <>
      {asks.length > 0 && (
        <>
          <div className="section"><h2>Waiting for you</h2></div>
          <div className="list">
            {asks.map((r) => (
              <div className="list__item" key={r.requestId} style={{ cursor: 'default' }}>
                <div className="avatar">{r.memberName.slice(0, 1).toUpperCase()}</div>
                <div className="list__body">
                  <div className="list__title num">{r.amount} {st.symbol}</div>
                  <div className="list__sub">{r.memberName} · {r.toName}</div>
                </div>
                <div className="list__end">
                  <button className="btn btn--sm btn--go"
                    onClick={() => act('Approving', (a) => post(`/api/requests/${r.requestId}/approve`, {}, a), 'Approved and paid.')}>
                    Approve
                  </button>
                  <button className="btn btn--sm btn--danger"
                    onClick={() => act('Declining', (a) => post(`/api/requests/${r.requestId}/deny`, {}, a), 'Declined.')}>
                    No
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section">
        <h2>Family</h2>
        <button className="info" onClick={() => onInfo('committed')} aria-label="Committed to the family">i</button>
      </div>

      {st.members.length === 0
        ? <Empty icon={<Icon.family />} title="No one yet">Invite someone — they're set up in one tap.</Empty>
        : (
          <div className="list">
            {st.members.map((m) => (
              <button className="list__item" key={m.id} onClick={() => setOpen(m)}>
                <div className={`avatar${m.scopeId && !m.revoked ? '' : ' avatar--off'}`}>{m.name.slice(0, 1).toUpperCase()}</div>
                <div className="list__body">
                  <div className="list__title">{m.name}</div>
                  <div className="list__sub">
                    {m.scopeId && !m.revoked
                      ? <><span className="num">{m.spendable}</span> {st.symbol} left this week</>
                      : m.revoked ? 'Turned off' : 'No limits yet'}
                  </div>
                </div>
                <div className="list__end">
                  {m.revoked && <span className="pill pill--off">off</span>}
                  <Icon.chevron />
                </div>
              </button>
            ))}
          </div>
        )}

      <button className="btn btn--quiet btn--block mt4" onClick={() => { setLink(''); setCopied(false); setInviting(true) }}>
        Invite someone
      </button>

      {/* One person, one sheet — limits, the on-chain permission, and the
          only two actions that apply to them. */}
      <Sheet open={Boolean(open)} title={open?.name ?? ''} onClose={() => setOpen(null)}>
        {open && (
          <>
            <dl className="dl">
              <div className="dl__row"><dt>Each purchase</dt><dd>{open.caps ? `${open.caps.perTx} ${st.symbol}` : '—'}</dd></div>
              <div className="dl__row"><dt>Each week</dt><dd>{open.caps ? `${open.caps.period} ${st.symbol}` : '—'}</dd></div>
              <div className="dl__row"><dt>Used this week</dt><dd className="num">{open.spentThisPeriod} {st.symbol}</dd></div>
              <div className="dl__row"><dt>Can spend now</dt><dd className="num">{open.spendable} {st.symbol}</dd></div>
            </dl>

            {open.scopeId && (
              <details className="perm">
                <summary>Permission on-chain</summary>
                <code className="mono">{open.scopeId}</code>
              </details>
            )}

            <button className="btn btn--primary btn--block mt4"
              onClick={() => { setPerTx(open.caps?.perTx ?? '50'); setPeriod(open.caps?.period ?? '120'); setOpen(null); setLimits(open) }}>
              {open.scopeId && !open.revoked ? 'Change limits' : 'Set limits'}
            </button>
            {open.scopeId && !open.revoked && (
              <button className="btn btn--danger btn--block mt2"
                onClick={() => { const m = open; setOpen(null); act('Turning off', (a) => post(`/api/members/${m.id}/revoke`, {}, a), `${m.name} can't spend any more.`) }}>
                Turn off spending
              </button>
            )}
          </>
        )}
      </Sheet>

      <Sheet open={Boolean(limits)} title={limits ? `${limits.name}'s limits` : ''} onClose={() => setLimits(null)}>
        <label htmlFor="perTx">Each purchase, at most</label>
        <input id="perTx" className="num" inputMode="decimal" value={perTx} onChange={(e) => setPerTx(e.target.value.replace(/[^0-9.]/g, ''))} />
        <label htmlFor="perWeek">Each week, at most</label>
        <input id="perWeek" className="num" inputMode="decimal" value={period} onChange={(e) => setPeriod(e.target.value.replace(/[^0-9.]/g, ''))} />
        <Fee quote={quote} symbol={st.symbol} />
        <button className="btn btn--primary btn--block mt4" disabled={!Number(perTx) || !Number(period)}
          onClick={() => {
            const m = limits!
            setLimits(null)
            act('Setting limits', (a) => post(`/api/members/${m.id}/grant`, { perTx, period, periodLengthDays: 7 }, a),
              `${m.name} can spend up to ${perTx} ${st.symbol} at a time.`)
          }}>
          Save limits
        </button>
      </Sheet>

      <Sheet open={inviting} title="Invite someone" onClose={() => setInviting(false)}>
        {!link ? (
          <>
            <label htmlFor="who">Their name</label>
            <input id="who" type="text" value={inviteName} autoFocus enterKeyHint="done"
              onChange={(e) => setInviteName(e.target.value)} />
            <button className="btn btn--primary btn--block mt4" disabled={!inviteName.trim()}
              onClick={async () => {
                const r = await api.post<{ joinPath: string }>('/api/invites', { name: inviteName })
                setLink(`${location.origin}${r.joinPath}`)
                setInviteName('')
              }}>
              Create link
            </button>
          </>
        ) : (
          <>
            <p className="hint">One tap sets them up. Nothing to install.</p>
            <div className="linkbox mono">{link}</div>
            <button className="btn btn--primary btn--block mt4"
              onClick={() => { navigator.clipboard?.writeText(link); setCopied(true) }}>
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </>
        )}
      </Sheet>
    </>
  )
}

function Activity({ st }: { st: ParentState }) {
  if (st.activity.length === 0) {
    return <Empty icon={<Icon.receipt />} title="Nothing yet">Money moved shows up here.</Empty>
  }
  return (
    <div className="list mt4">
      {st.activity.map((a) => (
        <div className="list__item" key={a.id} style={{ cursor: 'default' }}>
          <div className="list__body">
            <div className="list__title">{a.text}</div>
            <div className="list__sub">
              {new Date(a.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </div>
          </div>
          {a.txHash && (
            <a className="txlink" href={`https://sepolia.basescan.org/tx/${a.txHash}`} target="_blank" rel="noreferrer"
               aria-label="View receipt">↗</a>
          )}
        </div>
      ))}
    </div>
  )
}
