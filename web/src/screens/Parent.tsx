import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type FeeQuote, type ParentState } from '../api'
import { approvalProblem, approve, knownCredentialId, NeedsPassphrase, type Approval } from '../auth'
import { Sheet } from '../components/Sheet'
import { AccountButton, AccountSheet } from '../components/Account'
import { Confirm, type Pending } from '../components/Confirm'
import { OpModal, type Op } from '../components/Op'
import { figureSize, Figure, floor2, Icon, InfoButton, ScreenSkeleton, shortAddress, two } from '../components/ui'
import { Keypad } from '../components/Pay'
import { useAccruing } from '../useAccruing'
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
      'The balance is supplied to Aave and held as aUSDT in your own account. Nobody takes custody of it. Not us, not the app.',
      'When someone spends, their allowance redeems from that position and pays the shop in the same transaction.',
    ],
  },
  fees: {
    title: 'Who pays for what',
    body: [
      'You pay your own network fees in USDT, never ETH, and you never hold a native token.',
      'Everyone you invite is sponsored. They pay nothing, ever, and need no balance of any kind to spend.',
      'We quote a ceiling before you sign and charge what it actually cost, which is always less.',
    ],
  },
  promised: {
    title: 'Promised out',
    body: [
      'The total of everyone’s weekly limits. The spend manager is approved for exactly this amount. Never more, and never unlimited.',
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
  const [sheet, setSheet] = useState<'fees' | 'add' | null>(null)
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

    // The quote settles the price. It does *not* get to rewrite the steps:
    // `describe()` names the calls in the batch, which is implementation
    // detail, while the caller's list says what happens in the person's own
    // terms. Approving a child's ask is one `approveRequest` call, so the
    // quote calls it "Let the payment through" — but what actually happens is
    // money coming out of Aave and reaching the shop, which is what the
    // caller wrote and what the person should read. Quote steps are a
    // fallback for callers that give none.
    const plan = { steps: spec.steps, covered: false, quote: null as string | null }

    const run = async (approval: Approval) => {
      // One UserOperation. Every call in the batch lands together on
      // inclusion, so the steps fill at once rather than in sequence —
      // animating them one by one would be inventing progress that doesn't
      // exist.
      setPending(null)
      setOp({
        title: spec.title, steps: plan.steps, done: 0, status: 'running',
        symbol, covered: plan.covered,
        // The same ceiling the confirmation sheet showed. Without it the
        // modal's "fee, at most" row sat empty for the whole twenty seconds,
        // having just been quoted a number on the previous screen.
        quote: plan.quote,
      })
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

    // Nothing to price against means we genuinely don't know, and "0" would
    // be a claim rather than an absence. Every caller quotes today; this is
    // the honest floor if one ever stops.
    if (!spec.quote) { setPending((p) => p && { ...p, feeUnknown: true }); return }
    api.post<FeeQuote>('/api/quote', spec.quote)
      .then((q) => {
        if (q.steps?.length && spec.steps.length === 0) plan.steps = q.steps
        plan.covered = q.feeMode === 'sponsored'
        plan.quote = q.fee ?? null
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
          <Home st={st} onInfo={setNote} onFees={() => setSheet('fees')}
                onSeeAll={() => setTab('activity')} onCopied={flash}
                onAdd={() => setSheet('add')} />
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

      <AccountSheet
        open={sheet === 'fees'}
        onClose={() => setSheet(null)}
        name={st.you?.name ?? 'You'}
        role={`${st.familyName} household · you set the limits`}
        onSignOut={lock}
      >
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
      </AccountSheet>

      {/* Mounted only while open, so the amount starts empty every time —
          adding money closes the sheet from the outside, which never runs its
          own reset. */}
      {sheet === 'add' && <AddMoneySheet
        max={st.wallet.addable}
        symbol={st.symbol}
        onClose={() => setSheet(null)}
        onAdd={(amount) => {
          setSheet(null)
          act({
            title: `Move ${two(amount)} ${st.symbol} into Aave`,
            steps: ['Move it into Aave'],
            quote: { action: 'deposit', amount },
            call: (auth) => api.post('/api/deposit', { amount, auth }),
          })
        }}
      />}

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
 * Aave's rate, said the way a rate is said.
 *
 * Compounded per second, because that is what a supplier actually receives —
 * though at testnet rates the difference from the simple figure is invisible.
 */
function apyText(apr: number): string {
  if (apr <= 0) return 'nothing yet'
  const apy = (1 + apr / 31_536_000) ** 31_536_000 - 1
  return `${(apy * 100).toFixed(apy < 0.001 ? 4 : 2)}% a year`
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
  st, onInfo, onFees, onSeeAll, onCopied, onAdd,
}: {
  st: ParentState
  onInfo: (n: Note) => void
  onFees: () => void
  onSeeAll: () => void
  onCopied: (m: string) => void
  onAdd: () => void
}) {
  // What can actually be supplied, which is not the whole loose balance: the
  // account keeps a few operations' worth back to pay its own fees with.
  const addable = st.wallet.addable

  // The position is earning while this is on screen, so show it earning.
  const pot = useAccruing(st.wallet.pot, st.wallet.apr ?? 0, st.wallet.potAt ?? Date.now())

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
        <AccountButton initial={st.you?.name?.[0] ?? 'K'} onOpen={onFees} />
      </div>

      <div className="balance">
        <div className="sec" style={{ padding: 0 }}>
          <div className="kicker">Balance</div>
          <InfoButton label="Where the money sits" onClick={() => onInfo('balance')} />
        </div>
        <div style={{ marginTop: 12 }}>
          <Figure value={pot} live={(st.wallet.apr ?? 0) > 0} />
        </div>
        <div className="note mt3">
          {(st.wallet.apr ?? 0) > 0 && <span className="livedot" aria-hidden="true" />}
          {st.symbol} · earning {apyText(st.wallet.apr ?? 0)} in Aave
        </div>
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
              onClick={onAdd}
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

/* ── adding money ────────────────────────────────────────────────────────── */

/**
 * How much to move into Aave.
 *
 * It used to take the whole spare balance without asking, which is a strange
 * thing for a wallet to do — so it asks, with the ceiling one tap away for
 * the common case of moving all of it.
 *
 * The ceiling is not the loose balance: the account keeps a few operations'
 * worth of USDT back, because it pays its own network fees in USDT and an
 * account that supplies every last token cannot afford its next transaction.
 */
function AddMoneySheet({
  max, symbol, onClose, onAdd,
}: {
  max: string
  symbol: string
  onClose: () => void
  onAdd: (amount: string) => void
}) {
  const [amount, setAmount] = useState('')
  const value = Number(amount || '0')
  const ceiling = Number(max)
  const over = value > ceiling
  const ok = value > 0 && !over

  const close = () => { setAmount(''); onClose() }

  return (
    <Sheet open title="Add money" onClose={close}>
      <div
        className={`amount-screen__big${amount === '' ? ' amount-screen__big--empty' : over ? ' amount-screen__big--over' : ''}`}
        style={{ justifyContent: 'center', margin: '4px 0 8px' }}
        role="status"
        aria-live="polite"
        aria-label={`${amount || '0'} ${symbol}`}
      >
        <span className="amount-screen__unit">{symbol}</span>
        <span className="amount-screen__value" style={{ fontSize: figureSize(amount || '0') }}>
          {amount === '' ? '0' : amount}
        </span>
      </div>

      <p className="amount-screen__under">
        {over
          ? `Only ${floor2(max)} can be moved. The rest covers network fees.`
          : `${floor2(max)} ${symbol} ready · earns in Aave straight away`}
      </p>

      {ceiling > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10 }}>
          <button className="maxchip tap" onClick={() => setAmount(floor2(max))}>Use the lot</button>
        </div>
      )}

      <div className="mt3">
        <Keypad value={amount} onChange={setAmount} />
      </div>

      <button className="btn tap mt4" disabled={!ok} onClick={() => onAdd(amount)}>
        {value <= 0 ? 'Enter an amount' : over ? 'Too much' : `Add ${two(amount)}`}
      </button>
    </Sheet>
  )
}
