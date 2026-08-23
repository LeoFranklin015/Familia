import { useState } from 'react'
import { api, type ParentState, type Service, type Subscription } from '../../api'
import { Icon } from '../../components/ui'
import { two } from '../../lib/money'
import { when } from '../../lib/time'
import type { Act } from '../Parent'

/**
 * A colour per service, so the list is scannable without shipping logos we have
 * no licence to. The monogram carries the identity.
 */
const TINTS: Record<string, string> = {
  netflix: '#e50914',
  spotify: '#1db954',
  disney: '#4b6cd6',
  youtube: '#ff4e45',
  icloud: '#4a9fe0',
}

function Badge({ id, name }: { id: string; name: string }) {
  const tint = TINTS[id] ?? 'var(--accent)'
  return (
    <span
      className="subs__badge"
      style={{ background: `${tint}22`, color: tint }}
      aria-hidden="true"
    >
      {name[0]}
    </span>
  )
}

/* ── Subscriptions ───────────────────────────────────────────────────────── */

/**
 * Recurring mandates, which are the same on-chain object as a child's
 * allowance: a scope with a biller as the spender.
 *
 * The three buttons here map one to one onto the contract. Subscribing grants a
 * scope capped at one month's price and allowlisted to the service's payout
 * address. Collecting is the biller calling `spend`, from its own account,
 * paying its own gas. Cancelling revokes.
 */
export function SubsTab({
  st, act, reload,
}: {
  st: ParentState
  act: Act
  reload: () => Promise<void>
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [said, setSaid] = useState<{ id: string; text: string; bad: boolean } | null>(null)

  const running = st.subscriptions.filter((s) => !s.revoked)
  const taken = new Set(running.map((s) => s.serviceId))
  const available = st.services.filter((s) => !taken.has(s.id))
  const monthly = running.reduce((t, s) => t + Number(s.price), 0)

  const subscribe = (service: Service) =>
    act({
      title: `Subscribe to ${service.name}`,
      steps: [`Let ${service.name} take ${service.price} a month`],
      quote: { action: 'subscribe', serviceId: service.id },
      call: (auth) => api.post(`/api/subscriptions/${service.id}/subscribe`, { auth }),
    })

  const cancel = (sub: Subscription) =>
    act({
      title: `Cancel ${sub.name}`,
      steps: ['Revoke the mandate on-chain'],
      quote: { action: 'unsubscribe', subscriptionId: sub.id },
      call: (auth) => api.post(`/api/subscriptions/${sub.id}/cancel`, { auth }),
    })

  /**
   * Stand in for the scheduler that would run this monthly.
   *
   * No signature is asked for, because the household is not the one paying:
   * the biller sends its own transaction. A second press inside the same month
   * is refused by the contract, and that refusal is what shows up here.
   */
  const charge = async (sub: Subscription) => {
    setBusy(sub.id); setSaid(null)
    try {
      const res = await api.post<{ amount: string }>(`/api/subscriptions/${sub.id}/charge`)
      setSaid({ id: sub.id, text: `Took ${two(res.amount)} ${st.symbol}`, bad: false })
      await reload()
    } catch (e) {
      setSaid({ id: sub.id, text: e instanceof Error ? e.message : 'That did not work.', bad: true })
    } finally { setBusy(null) }
  }

  return (
    <div className="scroll"><div className="page">
      <h2 className="h2" style={{ margin: '0 8px 6px' }}>Subscriptions</h2>
      <p className="hint" style={{ margin: '0 8px 20px' }}>
        Each one is a mandate on the same contract your family&rsquo;s limits use.
        A service can take its price once a month, only to its own address, and
        you can stop it without asking it first.
      </p>

      {running.length > 0 && (
        <>
          <div className="sec">
            <div className="kicker kicker--muted">Running</div>
            <div className="kicker kicker--muted">
              {two(String(monthly))} {st.symbol} a month
            </div>
          </div>

          {running.map((sub) => (
            <div key={sub.id} className="subs">
              <div className="subs__top">
                <Badge id={sub.serviceId} name={sub.name} />
                <div className="row__body">
                  <span className="recipient__name">{sub.name}</span>
                  <span className="recipient__addr">
                    {two(sub.price)} {st.symbol} a month
                    {sub.charges.length > 0 && ` · ${sub.charges.length} taken`}
                  </span>
                </div>
                <button className="link tap link--sm" onClick={() => cancel(sub)}>Cancel</button>
              </div>

              <div className="subs__foot">
                <span className="note">
                  {sub.dueNow
                    ? 'Due now'
                    : sub.renewsAt
                      ? `Nothing more until ${when(sub.renewsAt * 1000)}`
                      : 'Waiting on the chain'}
                </span>
                <button
                  className="btn btn--sm tap"
                  style={{ minHeight: 40, fontSize: 13, width: 'auto', padding: '0 16px' }}
                  disabled={busy === sub.id || !sub.dueNow}
                  onClick={() => charge(sub)}
                >
                  {busy === sub.id ? <><span className="spin" />Collecting</> : 'Collect now'}
                </button>
              </div>

              {said?.id === sub.id && (
                <p className={said.bad ? 'warn' : 'note'} style={{ marginTop: 10 }} role="status">
                  {said.text}
                </p>
              )}
            </div>
          ))}
        </>
      )}

      <div className="sec sec--top">
        <div className="kicker kicker--muted">{running.length ? 'Add another' : 'Add one'}</div>
      </div>

      {available.length > 0 ? available.map((service) => (
        <div key={service.id} className="recipient">
          <Badge id={service.id} name={service.name} />
          <span className="row__body">
            <span className="recipient__name">{service.name}</span>
            <span className="recipient__addr">{two(service.price)} {st.symbol} a month</span>
          </span>
          <button className="link tap link--sm" onClick={() => subscribe(service)}>Subscribe</button>
        </div>
      )) : (
        <p className="empty empty--bare">You are signed up to everything on offer.</p>
      )}

      <div className="callout mt4">
        <Icon name="lock" size={18} />
        <p className="note">
          The cap and the destination are both on-chain. A service cannot take
          twice in a month or send the money anywhere else, whatever it asks for.
        </p>
      </div>
    </div></div>
  )
}
