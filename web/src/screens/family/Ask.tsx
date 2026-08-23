import { api, type ParentState } from '../../api'
import { Icon } from '../../components/ui'
import { whenLower } from '../../lib/time'
import type { Act } from '../Parent'

/* ── one ask ─────────────────────────────────────────────────────────────── */

export function Ask({ r, act }: { r: ParentState['pendingRequests'][number]; act: Act }) {
  const settle = (verdict: 'approve' | 'deny') => act({
    title: verdict === 'approve'
      ? `Pay ${r.amount} to ${r.toName} for ${r.memberName}`
      : `Turn down ${r.memberName}'s ${r.amount}`,
    detail: verdict === 'approve'
      ? [
          { label: 'Amount', value: r.amount },
          { label: 'To', value: r.toName },
          { label: 'For', value: r.memberName },
          ...(r.offList ? [{ label: 'Note', value: 'Outside their places' }] : []),
        ]
      : [
          { label: 'Turning down', value: `${r.amount} to ${r.toName}` },
          { label: 'Nothing moves', value: 'The ask is closed on-chain' },
        ],
    steps: verdict === 'approve'
      ? ['Take it out of Aave', `Send it to ${r.toName}`]
      : ['Turn down the ask on-chain'],
    quote: { action: 'settle', requestId: r.requestId, verdict },
    call: (auth) => api.post(`/api/requests/${r.requestId}/${verdict}`, { auth }),
  })

  return (
    <div className="ask">
      <div className="ask__text">{r.memberName} wants to pay {r.amount} at {r.toName}.</div>
      <div className="ask__at">Asked {whenLower(r.createdAt)}</div>
      {r.offList && (
        <div className="ask__flag">
          <Icon name="warning" size={14} />
          <span>Outside {r.memberName}&rsquo;s places. Saying yes pays it anyway.</span>
        </div>
      )}
      <div className="ask__do">
        <button className="btn btn--sm btn--row tap" onClick={() => settle('approve')}>Approve</button>
        <button
          className="btn btn--quiet btn--sm tap"
          style={{ width: 'auto', padding: '0 20px', minHeight: 46 }}
          onClick={() => settle('deny')}
        >
          Not this one
        </button>
      </div>
    </div>
  )
}
