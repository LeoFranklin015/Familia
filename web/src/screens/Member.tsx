import { useCallback, useState } from 'react'
import { usePoll } from '../usePoll'
import { api, type MemberState } from '../api'
import { type Approval } from '../auth'
import { useApproval } from '../useApproval'
import { PassphraseSheet } from '../components/PassphraseSheet'
import { TabBar, type Tab } from '../components/TabBar'
import { Confirm } from '../components/Confirm'
import { OpModal, type Op } from '../components/Op'
import { AccountButton, AccountSheet } from '../components/Account'
import { AmountStep, WhoStep } from '../components/Pay'
import { labelFor, looksLikeAddress } from '../lib/address'
import { Scan, scanningSupported } from '../components/Scan'
import { Blob, Figure, Icon, ScreenSkeleton } from '../components/ui'
import { base, fromBase, split, two } from '../lib/money'
import { resetDay, when } from '../lib/time'

type TabId = 'home' | 'pay' | 'activity'

/** Three, and never a hint that anyone else exists. */
const tabsFor = (waiting: number): ReadonlyArray<Tab<TabId>> => [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'pay', label: 'Pay', icon: 'pay' },
  { id: 'activity', label: 'Activity', icon: 'activity', badge: waiting },
]

/**
 * The whole app, for a kid.
 *
 * Two screens and one question: who, and how much. There is no balance here
 * and no sign that anyone else exists — the server refuses to tell this
 * session either, so it is a rule rather than a hidden view.
 *
 * The important behaviour is that the button never dies. Over the limit it
 * stops promising a payment and starts promising a request, which is what the
 * contract will actually do: `spend` above the cap doesn't fail, it becomes
 * something a guardian can wave through.
 */
export default function Member({ onLogout }: { onLogout: () => void }) {
  const [me, setMe] = useState<MemberState | null>(null)
  const [tab, setTab] = useState<TabId>('home')
  const [step, setStep] = useState<'who' | 'amount'>('who')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [scan, setScan] = useState(false)
  const [account, setAccount] = useState(false)
  const { pending, setPending, ask, passphrase } = useApproval()
  const [op, setOp] = useState<Op | null>(null)

  const load = useCallback(() => api.get<MemberState>('/api/me').then(setMe).catch(() => {}), [])
  usePoll(load)

  if (!me) {
    return (
      <div className="screen">
        <div className="scroll"><ScreenSkeleton label="Loading" /></div>
      </div>
    )
  }

  // All of this arithmetic is in whole base units, the way the contract does
  // it. Compared as floats, `period - spent` lands a hair under the figure
  // shown for it about a sixth of the time — so typing exactly the number on
  // screen read as being *over* the limit.
  const value = base(amount || '0')
  // `headroom` is what the contract would actually clear right now:
  // min(week remaining, per-purchase cap, what the household can cover). The
  // week remaining is the number a person thinks in, so the card shows that
  // and the button obeys the headroom — and when they disagree, the hint says
  // which constraint is biting.
  const period = base(me.period)
  const spent = base(me.spentThisPeriod)
  const weekLeft = Math.max(0, period - spent)
  const headroom = base(me.headroom)
  const perTx = base(me.limit)
  const address = to.trim()
  const valid = looksLikeAddress(address)
  const name = labelFor(me.recipients, address)

  const overPerTx = perTx > 0 && value > perTx
  const overWeek = value > weekLeft
  // Within their own limits, but the household position can't cover it. A
  // guardian approving would not help — approveRequest still has to pull the
  // funds — so this is not an "ask" case.
  const shortAtHome = !overPerTx && !overWeek && value > headroom
  // Their own list, not the household's. `known` only means the address has a
  // name; being allowed to pay it is a separate question.
  const canPay = (a: string) =>
    !me.allowOnly || me.allowed.some((x) => x.toLowerCase() === a.trim().toLowerCase())
  const offList = valid && !canPay(address)

  // Anything the contract will not let them do on their own becomes a request
  // rather than a refusal. The chain agrees: `requestSpend` does not check the
  // allowlist, and neither does the guardian's `approveRequest`.
  const over = value > 0 && (overPerTx || overWeek || offList)
  const ready = valid && value > 0 && !shortAtHome

  /** Why this needs saying. Never a refusal: the only thing that stops a
   *  payment here is an address that isn't one. */
  const problem = !address ? undefined
    : !valid ? "That doesn't look like an address yet."
    : offList ? 'Not one of your places, so this one needs a yes from home.'
    : undefined

  const hint = offList ? 'Outside your places, so this goes home to say yes to.'
    : overPerTx ? `Over your ${two(me.limit)} limit, so this goes home to say yes to.`
    : overWeek && value > 0 ? 'More than you have left this week. A parent can wave it through.'
    : shortAtHome ? "There isn't enough at home to cover this right now."
    : undefined

  /**
   * Pay, or ask. Same button, same gesture, and the wording is decided by the
   * same arithmetic the contract will do.
   *
   * Members are always sponsored: a kid should never need a token balance to
   * spend an allowance, so no quote is fetched and the fee reads as covered.
   */
  const pay = () => {
    const asking = over
    const title = asking ? `Ask to pay ${two(amount)} to ${name}` : `Pay ${two(amount)} to ${name}`
    const steps = asking
      ? ['Try the payment', 'Turn it into a request']
      : ['Take it out of Aave', `Send it to ${name}`]

    const run = async (auth: Approval) => {
      setPending(null)
      setOp({ title, steps, done: 0, status: 'running', symbol: me.symbol, covered: true })
      try {
        const r = await api.post<{ kind: 'spent' | 'asked'; txHash?: string }>(
          '/api/spend', { to: address, amount, auth },
        )
        // The server decides pay-or-ask from `spendable()` on-chain; the
        // prediction above only chose what to *show*. Where they disagree —
        // a poll landing between the tap and the signature — report what
        // actually happened, not what was guessed. Telling someone their
        // money is waiting on a guardian when it has already gone is the
        // worst version of this screen being wrong.
        const settled = r.kind === 'asked'
          ? { title: `Asked to pay ${two(amount)}`, steps: ['Try the payment', 'Turn it into a request'] }
          : { title: `Paid ${two(amount)} to ${name}`, steps: ['Take it out of Aave', `Send it to ${name}`] }
        setOp((o) => o && {
          ...o, ...settled, status: 'done', done: settled.steps.length, txHash: r.txHash,
        })
        setAmount(''); setTo(''); setStep('who')
        await load()
      } catch (e) {
        setOp((o) => o && {
          ...o, status: 'failed',
          reason: e instanceof Error ? e.message : 'Something went wrong.',
        })
      }
    }

    ask({ title, fee: null, symbol: me.symbol, covered: true }, run)
  }

  const waiting = me.myRequests.filter((r) => r.status === 'pending').length

  /** Sign out. The vault stays; only this session ends. */
  const lock = async () => {
    try { await api.post('/api/logout') } catch { /* the session is going either way */ }
    onLogout()
  }

  /* Nothing to spend. Two different situations wearing the same shape: never
     granted, or turned off — and a kid deserves to know which. */
  if (!me.hasAllowance) {
    return (
      <div className="screen">
        <div className="scroll">
          <div className="page--full">
            <div className="sec">
              <div className="kicker">{me.familyName} household</div>
              <AccountButton initial={me.name[0] ?? 'K'} onOpen={() => setAccount(true)} />
            </div>
            <div className="spacer" />
            <div className="markbox" style={{ marginBottom: 20 }}>
              <Icon name="lock" size={24} />
            </div>
            <h2 className="title title--sm" style={{ marginBottom: 10 }}>
              {me.revoked ? 'Spending is off' : 'Nothing to spend yet'}
            </h2>
            <p className="lede">
              {me.revoked
                ? 'Someone at home turned it off. It can come back on the same way.'
                : 'Ask whoever set this up to give you a limit. It takes them a few seconds.'}
            </p>
            <div className="spacer" />
            <div className="kicker kicker--faint">Nothing here belongs to you yet</div>
          </div>
        </div>

        <AccountSheet
          open={account}
          onClose={() => setAccount(false)}
          name={me.name}
          role={`${me.familyName} household`}
          onSignOut={lock}
        />
      </div>
    )
  }

  return (
    <div className="screen">
      {tab === 'home' && (
        <div className="scroll"><div className="page">
          <div className="sec">
            <div className="kicker">{me.familyName} household</div>
            <AccountButton initial={me.name[0] ?? 'K'} onOpen={() => setAccount(true)} />
          </div>

          <div className="balance">
            <div className="kicker">Left this week</div>
            <div style={{ marginTop: 12 }}>
              <Figure value={fromBase(weekLeft)} unit={me.symbol} />
            </div>
            <div className="chip chip--static mt3">
              <Icon name="lock" size={14} />
              <span className="num">{two(me.limit)} max in one go</span>
            </div>
          </div>

          <div className="pair mt2">
            <div className="tile">
              <div className="tile__label">Spent this week</div>
              <div className="tile__figure">{two(me.spentThisPeriod)}</div>
              <div className="tile__note">of {two(me.period)}</div>
            </div>
            <div className="tile tile--pale">
              <div className="tile__label">Starts again</div>
              <div className="tile__figure">{resetDay(me.resetsAt)}</div>
              <div className="tile__note">the week resets</div>
            </div>
          </div>

          <button className="btn tap mt4" onClick={() => { setStep('who'); setTab('pay') }}>
            <Icon name="pay" size={18} />
            Pay someone
          </button>

          {me.activity.length > 0 && (
            <>
              <div className="sec sec--top">
                <div className="kicker kicker--muted">Recent</div>
                <button className="link tap" style={{ fontSize: 12.5 }} onClick={() => setTab('activity')}>
                  All of it
                </button>
              </div>
              <MyActivity items={me.activity.slice(0, 3)} />
            </>
          )}
        </div></div>
      )}

      {tab === 'pay' && (
        step === 'who' ? (
          <WhoStep
            context={
              <div className="sec">
                <div className="kicker">Pay someone</div>
                <AccountButton initial={me.name[0] ?? 'K'} onOpen={() => setAccount(true)} />
              </div>
            }
            value={to}
            onChange={setTo}
            onScan={() => setScan(true)}
            canScan={scanningSupported()}
            recipients={me.recipients}
            problem={problem}
            onNext={() => setStep('amount')}
            nextLabel={`Pay ${name}`}
          />
        ) : (
          <AmountStep
            to={name}
            onBack={() => setStep('who')}
            value={amount}
            onChange={setAmount}
            symbol={me.symbol}
            tone={over ? 'over' : 'normal'}
            under={hint ?? `${two(fromBase(weekLeft))} left this week · ${two(me.limit)} max in one go`}
            action={
              <button
                className={`btn tap${over ? ' btn--ask' : ''}`}
                disabled={!ready}
                onClick={pay}
              >
                {value <= 0 ? 'Enter an amount'
                  : over ? `Ask to pay ${two(amount)}`
                  : `Pay ${two(amount)} to ${name}`}
              </button>
            }
          />
        )
      )}

      {tab === 'activity' && (
        <div className="scroll"><MyWeek me={me} onAccount={() => setAccount(true)} /></div>
      )}

      <TabBar tabs={tabsFor(waiting)} value={tab} onChange={setTab} />

      {scan && <Scan onCancel={() => setScan(false)} onFound={(a) => { setTo(a); setScan(false) }} />}

      <AccountSheet
        open={account}
        onClose={() => setAccount(false)}
        name={me.name}
        role={`${me.familyName} household`}
        onSignOut={lock}
      >
        {me.hasAllowance && (
          <dl className="dl">
            <div className="dl__row">
              <dt>Most per purchase</dt>
              <dd>{two(me.limit)} {me.symbol}</dd>
            </div>
            <div className="dl__row">
              <dt>Most per week</dt>
              <dd>{two(me.period)} {me.symbol}</dd>
            </div>
            <div className="dl__row">
              <dt>Network fees</dt>
              <dd><span className="badge">Sponsored</span></dd>
            </div>
          </dl>
        )}
        <p className="hint mt3">
          Your limits are held by the contract, not by this app, and only
          someone at home can change them.
        </p>
      </AccountSheet>

      <PassphraseSheet prompt={passphrase} />

      <Confirm pending={pending} onCancel={() => setPending(null)} />
      <OpModal op={op} onClose={() => setOp(null)} />
    </div>
  )
}

/* ── their week ──────────────────────────────────────────────────────────── */

/**
 * The week as a ring.
 *
 * A kid's question is never "what is my period cap", it's "how much is left" —
 * and a filling ring answers that at a glance in a way two numbers never do.
 */
function MyWeek({ me, onAccount }: { me: MemberState; onAccount: () => void }) {
  const period = Number(me.period ?? 0)
  const spent = Number(me.spentThisPeriod)
  const fraction = period > 0 ? Math.min(1, spent / period) : 0
  const circumference = 2 * Math.PI * 96
  const s = split(me.spentThisPeriod)

  return (
    <div className="page">
      <div className="sec">
        <div className="kicker">This week</div>
        <AccountButton initial={me.name[0] ?? 'K'} onOpen={onAccount} />
      </div>

      <div className="ring">
        <Blob size={44} left={16} top={26} rotate={-16} opacity={0.5} />
        <Blob size={26} left={44} top={78} rotate={12} opacity={0.35} />
        <Blob size={34} right={20} bottom={24} rotate={-24} opacity={0.42} />

        <svg width="226" height="226" viewBox="0 0 226 226" role="img"
             aria-label={`${two(me.spentThisPeriod)} of ${two(me.period)} ${me.symbol} spent`}>
          <circle className="ring__track" cx="113" cy="113" r="96" />
          <circle
            className="ring__arc" cx="113" cy="113" r="96"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - fraction)}
          />
        </svg>

        <div className="ring__mid">
          <div className="kicker" style={{ fontSize: 10, letterSpacing: '0.12em' }}>Spent</div>
          <div className="figure figure--md" style={{ marginTop: 4 }}>
            <span className="figure__big">{s.big}</span>
            <span className="figure__cents">{s.cents}</span>
          </div>
          <div className="note mt1" style={{ fontSize: 11.5 }}>of {two(me.period)} {me.symbol}</div>
        </div>
      </div>

      <div className="pair mt3">
        <div className="tile" style={{ padding: '14px 16px' }}>
          <div className="tile__label" style={{ fontSize: 10 }}>Left</div>
          <div className="tile__figure" style={{ fontSize: 20, marginTop: 5 }}>
            {two(fromBase(Math.max(0, base(me.period) - base(me.spentThisPeriod))))}
          </div>
        </div>
        <div className="tile" style={{ padding: '14px 16px' }}>
          <div className="tile__label" style={{ fontSize: 10 }}>Starts again</div>
          <div className="tile__figure" style={{ fontSize: 20, marginTop: 5 }}>{resetDay(me.resetsAt)}</div>
        </div>
      </div>

      {me.activity.length > 0 ? (
        <div style={{ marginTop: 22 }}>
          <div className="kicker kicker--muted" style={{ padding: '0 8px 6px' }}>Yours</div>
          <MyActivity items={me.activity} />
        </div>
      ) : (
        <p className="empty mt5">Nothing spent yet. What you pay for shows up here.</p>
      )}
    </div>
  )
}

/**
 * A member's own history: what they paid for, and what is still waiting on
 * someone at home. Never anyone else's.
 */
function MyActivity({ items }: { items: MemberState['activity'] }) {
  return (
    <>
      {items.map((a) => {
        const waiting = a.kind === 'ask'
        return (
          <div
            key={a.id}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 8px', borderTop: '1px solid var(--line)' }}
          >
            <span
              className="avatar avatar--sm"
              style={{
                background: 'var(--fill-2)', borderColor: 'transparent',
                color: waiting ? 'var(--accent)' : 'var(--muted)',
              }}
            >
              <Icon name={waiting ? 'activity' : 'shop'} size={16} />
            </span>
            <span className="row__body">
              <span style={{ display: 'block', fontSize: 13.5, lineHeight: 1.4 }}>{a.text}</span>
              <span style={{ display: 'block', fontSize: 11, marginTop: 2, color: 'var(--faint)' }}>
                {when(a.at)}
              </span>
            </span>
            {waiting && <span className="tag tag--waiting">waiting</span>}
          </div>
        )
      })}
    </>
  )
}
