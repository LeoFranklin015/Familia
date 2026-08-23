import { useCallback, useEffect, useRef, useState } from 'react'
import { usePoll } from '../usePoll'
import { api, type FeeQuote, type ParentState } from '../api'
import { type Approval } from '../auth'
import { useApproval } from '../useApproval'
import { PassphraseSheet } from '../components/PassphraseSheet'
import { TabBar, type Tab } from '../components/TabBar'
import { Sheet } from '../components/Sheet'
import { AccountSheet } from '../components/Account'
import { Confirm } from '../components/Confirm'
import { OpModal, type Op } from '../components/Op'
import { ScreenSkeleton } from '../components/ui'
import { two } from '../lib/money'
import { Activity } from './Activity'
import { Home } from './parent/Home'
import { AddMoneySheet } from './parent/AddMoneySheet'
import { PayTab } from './ParentPay'
import { FamilyTab } from './ParentFamily'

type TabId = 'home' | 'pay' | 'family' | 'activity'

/** The guardian sees everything, so four. The badge counts asks waiting. */
const tabsFor = (waiting: number): ReadonlyArray<Tab<TabId>> => [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'pay', label: 'Pay', icon: 'pay' },
  { id: 'family', label: 'Family', icon: 'family', badge: waiting },
  { id: 'activity', label: 'Activity', icon: 'activity' },
]

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
  const [tab, setTab] = useState<TabId>('home')
  const [op, setOp] = useState<Op | null>(null)
  const [note, setNote] = useState<Note | null>(null)
  const [sheet, setSheet] = useState<'fees' | 'add' | null>(null)
  const [toast, setToast] = useState('')
  const { pending, setPending, ask, passphrase } = useApproval()

  const load = useCallback(
    () => api.get<ParentState>('/api/state').then(setSt).catch(() => {}),
    [],
  )
  usePoll(load)

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
    // The quote settles the price and nothing else. What the operation *does*
    // is named by the caller, in the person's own terms: approving a child's
    // ask is one `approveRequest` call, so the server would call it "let the
    // payment through", while what actually happens is money leaving Aave and
    // reaching the shop.
    //
    // Filled in by the quote below, and read when the person commits.
    const priced = { covered: false, ceiling: null as string | null }

    const run = async (approval: Approval) => {
      // One UserOperation. Every call in the batch lands together on
      // inclusion, so the steps fill at once rather than in sequence —
      // animating them one by one would be inventing progress that doesn't
      // exist.
      setPending(null)
      setOp({
        title: spec.title, steps: spec.steps, done: 0, status: 'running',
        symbol, covered: priced.covered,
        // The same ceiling the confirmation sheet showed. Without it the
        // modal's fee row sat empty for the whole twenty seconds, having just
        // quoted a number on the previous screen.
        quote: priced.ceiling,
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

    ask({ title: spec.title, fee: null, symbol }, run)

    // Nothing to price against means we genuinely don't know, and "0" would
    // be a claim rather than an absence. Every caller quotes today; this is
    // the honest floor if one ever stops.
    if (!spec.quote) { setPending((p) => p && { ...p, feeUnknown: true }); return }
    api.post<FeeQuote>('/api/quote', spec.quote)
      .then((q) => {
        priced.covered = q.feeMode === 'sponsored'
        priced.ceiling = q.fee ?? null
        setPending((p) => p && {
          ...p, fee: q.fee ?? null, covered: priced.covered, blocked: q.blocked,
        })
      })
      // A quote that won't come is not a blocker — the operation can still be
      // signed — but the row must stop pretending to load.
      .catch(() => setPending((p) => p && { ...p, fee: null, feeUnknown: true }))
  }, [st, load])

  if (!st) {
    return (
      <div className="screen">
        <div className="scroll"><ScreenSkeleton label="Loading your household" /></div>
      </div>
    )
  }

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

      <TabBar tabs={tabsFor(st.pendingRequests.length)} value={tab} onChange={setTab} />

      {toast && <div className="toast" role="status">{toast}</div>}

      {sheet === 'fees' && <AccountSheet
        open
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
            <dd>{two(st.promised)} {st.symbol}</dd>
          </div>
        </dl>
        <p className="hint mt3">
          Every payment costs a few thousandths of a dollar to put on-chain. Yours
          come out of your own account; the family&rsquo;s are covered, so nobody
          else ever sees a fee. We quote a ceiling before you sign and charge what
          it actually cost.
        </p>
      </AccountSheet>}

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

      <PassphraseSheet prompt={passphrase} />

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
