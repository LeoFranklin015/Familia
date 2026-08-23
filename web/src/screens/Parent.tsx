import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type FeeQuote, type ParentState } from '../api'
import { approvalProblem, approve, knownCredentialId, NeedsPassphrase, type Approval } from '../auth'
import { Sheet } from '../components/Sheet'
import { Confirm, type Pending } from '../components/Confirm'
import { OpModal, type Op } from '../components/Op'
import { Figure, Icon, InfoButton, ScreenSkeleton, shortAddress, two } from '../components/ui'
import { Activity } from './Activity'
import { PayTab } from './ParentPay'
import { FamilyTab } from './ParentFamily'

type Tab = 'home' | 'pay' | 'family' | 'activity'

/**
 * One write, start to finish.
 *
 * Every guardian write follows the same three beats: price it, confirm it, run
 * it. There is no on-chain ceiling behind these operations — the guardian is
 * the funder — so the person themselves is the only guard, and they are asked
 * each time.
 */
export type Spec = {
  /** What the confirmation sheet says is about to happen. */
  title: string
  /** What the operation does, if the quote can't say. */
  steps: string[]
  /** Body for /api/quote, so the price shown is for this exact batch. */
  quote?: Record<string, unknown>
  call: (auth: Approval) => Promise<{ feeCharged?: string | null; txHash?: string }>
}
export type Act = (spec: Spec) => void

/** Explanations live behind an (i), so no screen has to carry a paragraph. */
const NOTES = {
  balance: {
    title: 'Where the money sits',
    body: [
      'The balance is supplied to Aave and held as aUSDT in your own account. Nobody takes custody of it — not us, not the app.',
      'When someone spends, their allowance redeems from that position and pays the shop in the same transaction.',
    ],
  },
  fees: {
    title: 'Who pays for what',
    body: [
      'You pay your own network fees in USDT — never ETH, and you never hold a native token.',
      'Everyone you invite is sponsored. They pay nothing, ever, and need no balance of any kind to spend.',
      'We quote a ceiling before you sign and charge what it actually cost, which is always less.',
    ],
  },
  promised: {
    title: 'Promised out',
    body: [
      'The total of everyone’s weekly limits. The spend manager is approved for exactly this amount — never more, and never unlimited.',
      'It drops the moment you turn someone off.',
    ],
  },
} as const

export type Note = keyof typeof NOTES

export default function Parent({ onLogout }: { onLogout: () => void }) {
  const [st, setSt] = useState<ParentState | null>(null)
  const [tab, setTab] = useState<Tab>('home')
  const [op, setOp] = useState<Op | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [note, setNote] = useState<Note | null>(null)
  const [sheet, setSheet] = useState<'fees' | null>(null)
  const [askPass, setAskPass] = useState<((a: Approval) => void) | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [toast, setToast] = useState('')

  const load = useCallback(
    () => api.get<ParentState>('/api/state').then(setSt).catch(() => {}),
    [],
  )
  useEffect(() => {
    void load()
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [load])

  const toastTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(toastTimer.current), [])
  /** Sign out. The vault stays; only this session ends. */
  const lock = async () => {
    try { await api.post('/api/logout') } catch { /* the session is going either way */ }
    onLogout()
  }

  const flash = (m: string) => {
    setToast(m)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 1400)
  }

  /**
   * Price it, confirm it, run it.
   *
   * The quote is fetched while the confirmation sheet is already open, so the
   * sheet appears immediately and the fee fills in — a spinner in front of the
   * whole flow would be slower for no more information.
   */
  const act: Act = useCallback((spec) => {
    if (!st) return
    const symbol = st.symbol

    // The quote knows the real step list, because it builds the real batch.
    // It lands after the sheet is already up, so the plan is held here and
    // read when the person actually commits.
    const plan = { steps: spec.steps, covered: false }

    const run = async (approval: Approval) => {
      // One UserOperation. Every call in the batch lands together on
      // inclusion, so the steps fill at once rather than in sequence —
      // animating them one by one would be inventing progress that doesn't
      // exist.
      setPending(null)
      setOp({ title: spec.title, steps: plan.steps, done: 0, status: 'running', symbol, covered: plan.covered })
      try {
        const res = await spec.call(approval)
        setOp((o) => o && {
          ...o, status: 'done', done: o.steps.length,
          charged: res?.feeCharged ?? null, txHash: res?.txHash,
        })
        await load()
      } catch (e) {
        setOp((o) => o && {
          ...o, status: 'failed',
          reason: e instanceof Error ? e.message : 'Something went wrong.',
        })
      }
    }

    const start = () => {
      approve().then(run).catch((e) => {
        // Hand off to the passphrase sheet, and drop the Face ID sheet:
        // they stack, and Confirm sits above it.
        if (e instanceof NeedsPassphrase) { setPending(null); setAskPass(() => run); return }
        // A cancelled or failed prompt: say so in the sheet rather than
        // making it vanish with nothing to read.
        setPending((p) => p && { ...p, blocked: approvalProblem(e) })
      })
    }

    setPending({ title: spec.title, fee: null, symbol, run: start })

    if (!spec.quote) { setPending((p) => p && { ...p, fee: '0' }); return }
    api.post<FeeQuote>('/api/quote', spec.quote)
      .then((q) => {
        if (q.steps?.length) plan.steps = q.steps
        plan.covered = q.feeMode === 'sponsored'
        setPending((p) => p && {
          ...p, fee: q.fee ?? null, covered: plan.covered, blocked: q.blocked,
        })
      })
      // A quote that won't come is not a blocker — the operation can still be
      // signed — but the row must stop pretending to load.
      .catch(() => setPending((p) => p && { ...p, fee: null, feeUnknown: true }))
  }, [st, load])

  const withPassphrase = () => {
    const credentialId = knownCredentialId()
    const run = askPass
    const pass = passphrase
    setAskPass(null); setPassphrase('')
    if (credentialId && run) run({ credentialId, passphrase: pass })
  }

  if (!st) {
    return (
      <div className="screen">
        <div className="scroll"><ScreenSkeleton label="Loading your household" /></div>
      </div>
    )
  }

  const asks = st.pendingRequests
  const funding = st.wallet.setup.status === 'running'

  return (
    <div className="screen">
      {/* Each tab owns its own scrolling pane, so a tab with an action bar or
          a full-screen overlay can put it outside that pane rather than
          leaning on how `overflow` treats absolutely-positioned children. */}
      {tab === 'home' && (
        <div className="scroll">
          <Home st={st} act={act} onInfo={setNote} onFees={() => setSheet('fees')}
                onSeeAll={() => setTab('activity')} onCopied={flash} />
        </div>
      )}
      {tab === 'activity' && (
        <div className="scroll"><Activity items={st.activity} title="Activity" /></div>
      )}
      {tab === 'pay' && <PayTab st={st} act={act} />}
      {tab === 'family' && <FamilyTab st={st} act={act} onCopied={flash} reload={load} />}

      <nav className="tabbar" role="tablist" aria-label="Sections">
        {([
          ['home', 'Home', 'home'],
          ['pay', 'Pay', 'pay'],
          ['family', 'Family', 'family'],
          ['activity', 'Activity', 'activity'],
        ] as const).map(([id, label, icon]) => (
          <button
            key={id} role="tab" aria-selected={tab === id}
            className={`tab tap${tab === id ? ' tab--on' : ''}`}
            aria-label={id === 'family' && asks.length > 0
              ? `${label}, ${asks.length} waiting`
              : label}
            onClick={() => setTab(id)}
          >
            <Icon name={icon} size={19} />
            {tab === id && <span>{label}</span>}
            {id === 'family' && asks.length > 0 && (
              <span className="tab__badge" aria-hidden="true">{asks.length}</span>
            )}
          </button>
        ))}
      </nav>

      {toast && <div className="toast" role="status">{toast}</div>}

      <Sheet open={sheet === 'fees'} title="Account & fees" onClose={() => setSheet(null)}>
        <dl className="dl">
          <div className="dl__row">
            <dt>You pay fees in</dt>
            <dd>{st.wallet.feeMode === 'usdt' ? st.symbol : 'Nothing yet'}</dd>
          </div>
          <div className="dl__row">
            <dt>Everyone else pays</dt>
            <dd>Nothing</dd>
          </div>
          <div className="dl__row">
            <dt>Promised in limits</dt>
            <dd>{promised(st)} {st.symbol}</dd>
          </div>
        </dl>
        <p className="hint mt3">
          Every payment costs a few thousandths of a dollar to put on-chain. Yours
          come out of your own account; the family&rsquo;s are covered, so nobody
          else ever sees a fee. We quote a ceiling before you sign and charge what
          it actually cost.
        </p>
        <button className="btn btn--quiet tap mt4" onClick={() => setSheet(null)}>Got it</button>
        <button className="link tap mt2" style={{ display: 'block', margin: '10px auto 0' }} onClick={lock}>
          Lock this device
        </button>
      </Sheet>

      <Sheet open={Boolean(note)} title={note ? NOTES[note].title : ''} onClose={() => setNote(null)}>
        {note && NOTES[note].body.map((p, i) => (
          <p key={i} className="hint" style={{ marginTop: i ? 12 : 0 }}>{p}</p>
        ))}
        <button className="btn btn--quiet tap mt4" onClick={() => setNote(null)}>Got it</button>
      </Sheet>

      <Sheet open={Boolean(askPass)} title="Confirm it's you" onClose={() => setAskPass(null)}>
        <p className="hint">This device can&rsquo;t use Face ID, so your passphrase approves it.</p>
        <label className="field mt3">
          <span>Passphrase</span>
          <input
            className="input" type="password" value={passphrase} autoFocus enterKeyHint="go"
            onChange={(e) => setPassphrase(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && passphrase.length >= 8) withPassphrase() }}
          />
        </label>
        <button className="btn tap mt4" disabled={passphrase.length < 8} onClick={withPassphrase}>
          Approve
        </button>
      </Sheet>

      <Confirm pending={pending} onCancel={() => setPending(null)} />

      {/* Onboarding funding is an operation like any other, so it gets the
          same surface — and cannot be dismissed, because it is what makes the
          account usable at all. */}
      <OpModal
        op={funding
          ? {
              title: 'Setting up your account',
              steps: ['Make your account', 'Get your first USDT', 'Turn on fee payments'],
              done: 1, status: 'running', symbol: st.symbol, covered: true,
            }
          : op}
        onClose={() => setOp(null)}
      />
    </div>
  )
}

/**
 * Sum of the weekly limits the manager is actually approved for.
 *
 * Mirrors the server's `outstandingCaps`: a live scope, not turned off.
 * Counting revoked people would contradict the note beside it, which promises
 * the figure drops the moment someone is turned off.
 */
function promised(st: ParentState): string {
  return two(st.members
    .filter((m) => m.scopeId && !m.revoked)
    .reduce((t, m) => t + Number(m.caps?.period ?? 0), 0))
}

/* ── Home ────────────────────────────────────────────────────────────────── */

function Home({
  st, act, onInfo, onFees, onSeeAll, onCopied,
}: {
  st: ParentState
  act: Act
  onInfo: (n: Note) => void
  onFees: () => void
  onSeeAll: () => void
  onCopied: (m: string) => void
}) {
  // What can actually be supplied, which is not the whole loose balance: the
  // account keeps a few operations' worth back to pay its own fees with.
  const addable = st.wallet.addable

  const addMoney = () => act({
    title: `Move ${two(addable)} ${st.symbol} into Aave`,
    steps: ['Move it into Aave'],
    quote: { action: 'deposit', amount: addable },
    call: (auth) => api.post('/api/deposit', { amount: addable, auth }),
  })

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(st.wallet.address)
      onCopied('Address copied')
    } catch { onCopied("Couldn't copy") }
  }

  return (
    <div className="page">
      <div className="sec">
        <div className="kicker">{st.familyName} household</div>
        <InfoButton label="Account and fees" onClick={onFees} />
      </div>

      <div className="balance">
        <div className="sec" style={{ padding: 0 }}>
          <div className="kicker">Balance</div>
          <InfoButton label="Where the money sits" onClick={() => onInfo('balance')} />
        </div>
        <div style={{ marginTop: 12 }}>
          <Figure value={st.wallet.pot} />
        </div>
        <div className="note mt3">{st.symbol} · earning in Aave</div>
        <button className="chip tap mt4" onClick={copy} aria-label="Copy your account address">
          <span className="chip__addr">{shortAddress(st.wallet.address)}</span>
          <span className="chip__do">copy</span>
        </button>
      </div>

      <div className="pair mt2">
        <div className="tile">
          <div className="tile__label">Promised out</div>
          <div className="tile__figure">{promised(st)}</div>
          <div className="tile__note">in weekly limits</div>
        </div>
        <div className="tile tile--pale">
          <div className="tile__label">Ready to add</div>
          <div className="tile__figure">{two(addable)}</div>
          {Number(addable) > 0 ? (
            <button
              className="btn btn--sm tap mt3"
              style={{ background: 'var(--ink)', color: 'var(--pale)', minHeight: 44, fontSize: 13.5 }}
              onClick={addMoney}
            >
              Add money
            </button>
          ) : (
            <div className="tile__note">The faucet tops you up once a day</div>
          )}
        </div>
      </div>

      <div className="sec sec--top">
        <div className="kicker kicker--muted">Recent</div>
        {st.activity.length > 0 && (
          <button className="link tap" style={{ fontSize: 12.5 }} onClick={onSeeAll}>All of it</button>
        )}
      </div>

      {st.activity.length > 0
        ? <Activity items={st.activity.slice(0, 3)} />
        : (
          <p className="empty empty--bare">
            Money you add, limits you set and payments the family makes all show up here.
          </p>
        )}
    </div>
  )
}
