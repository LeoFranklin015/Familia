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
import { Scan, scanningSupported } from '../components/Scan'
import { Figure, Icon, ScreenSkeleton } from '../components/ui'
import { fromBase, two } from '../lib/money'
import { resetDay } from '../lib/time'
import { spendState } from './member/spendState'
import { MyActivity, MyWeek } from './member/Week'

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

  const address = to.trim()
  const { value, weekLeft, name, over, ready, problem, hint } = spendState(me, to, amount)

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
