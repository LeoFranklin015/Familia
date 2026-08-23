import type { MemberState } from '../../api'
import { AccountButton } from '../../components/Account'
import { Blob, Icon } from '../../components/ui'
import { base, fromBase, split, two } from '../../lib/money'
import { resetDay, when } from '../../lib/time'

/**
 * The week as a ring.
 *
 * A kid's question is never "what is my period cap", it's "how much is left" —
 * and a filling ring answers that at a glance in a way two numbers never do.
 */
export function MyWeek({ me, onAccount }: { me: MemberState; onAccount: () => void }) {
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
export function MyActivity({ items }: { items: MemberState['activity'] }) {
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
