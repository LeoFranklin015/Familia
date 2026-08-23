import { useState } from 'react'
import { api, type ParentState } from '../api'
import { Sheet } from '../components/Sheet'
import { Icon } from '../components/ui'
import { two } from '../lib/money'
import { resetDay } from '../lib/time'
import { Ask } from './family/Ask'
import { BookSheet } from './family/BookSheet'
import { InviteSheet } from './family/InviteSheet'
import { LimitsSheet } from './family/LimitsSheet'
import { PlacesSheet } from './family/PlacesSheet'
import { Row } from './family/rows'
import type { Act } from './Parent'

type Member = ParentState['members'][number]
type Which = 'invite' | 'person' | 'limits' | 'places' | 'book' | null

export function FamilyTab({
  st, act, onCopied, reload,
}: {
  st: ParentState
  act: Act
  onCopied: (m: string) => void
  reload: () => Promise<void>
}) {
  const [sheet, setSheet] = useState<Which>(null)
  const [personId, setPersonId] = useState<string | null>(null)
  const [scopeOpen, setScopeOpen] = useState(false)
  const person = st.members.find((m) => m.id === personId) ?? null

  const openPerson = (m: Member) => {
    setPersonId(m.id)
    setScopeOpen(false)
    setSheet('person')
  }

  return (
    <>
      <div className="scroll"><div className="page">
        <h2 className="h2" style={{ margin: '0 8px 20px' }}>Family</h2>

        {st.pendingRequests.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div className="kicker kicker--accent" style={{ padding: '0 8px 8px' }}>Waiting for you</div>
            {st.pendingRequests.map((r) => (
              <Ask key={r.requestId} r={r} act={act} />
            ))}
          </div>
        )}

        <div className="kicker kicker--muted" style={{ padding: '16px 8px 8px' }}>People</div>
        {st.members.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {st.members.map((m) => (
              <button key={m.id} className="person tap" onClick={() => openPerson(m)}>
                <span className={`avatar${m.revoked ? ' avatar--off' : ''}`}>
                  {m.name[0]?.toUpperCase()}
                </span>
                <span className="row__body">
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="person__name">{m.name}</span>
                    {m.revoked && <span className="tag">off</span>}
                  </span>
                  <span className={`person__status${m.revoked || !m.caps ? ' person__status--off' : ''}`}>
                    {status(m, st.symbol)}
                  </span>
                </span>
                <Icon name="right" size={16} />
              </button>
            ))}
          </div>
        ) : (
          <p className="empty">No one yet. Invite someone and they&rsquo;re set up in a tap.</p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 20 }}>
          <button className="btn tap" onClick={() => setSheet('invite')}>Invite someone</button>
          <button className="btn btn--quiet tap" onClick={() => setSheet('book')}>
            Address book
          </button>
        </div>
      </div></div>

      <InviteSheet
        open={sheet === 'invite'}
        onClose={() => { setSheet(null); void reload() }}
        onCopied={onCopied}
      />

      <Sheet
        open={sheet === 'person' && Boolean(person)}
        title={person?.name ?? ''}
        // Clearing the id unmounts the limits sheet too, so its drafts start
        // from the saved caps next time rather than from what was last typed.
        onClose={() => { setSheet(null); setPersonId(null) }}
        head={person && (
          <span className={`avatar${person.revoked ? ' avatar--off' : ''}`} style={{ width: 44, height: 44 }}>
            {person.name[0]?.toUpperCase()}
          </span>
        )}
      >
        {person && (
          <>
            {person.caps ? (
              <>
                <dl className="dl">
                  <Row label="Most per purchase" value={`${two(person.caps.perTx)} ${st.symbol}`} />
                  <Row label="Most per week" value={`${two(person.caps.period)} ${st.symbol}`} />
                  <Row label="Spent this week" value={`${two(person.spentThisPeriod)} ${st.symbol}`} />
                  <Row
                    label="Can spend now"
                    value={person.revoked ? 'Nothing' : `${two(person.spendable)} ${st.symbol}`}
                    tone={person.revoked ? 'accent' : undefined}
                  />
                  <Row label="Starts again" value={resetDay(person.resetsAt)} />
                  <Row
                    label="Can pay"
                    value={person.allowOnly
                      ? `${person.allowed.length} ${person.allowed.length === 1 ? 'place' : 'places'}`
                      : 'Anywhere'}
                  />
                </dl>

                {/* The on-chain id, folded away. It is the proof the limits are
                    real rather than app state, and almost nobody needs to see
                    it — so it is available, not present. */}
                <button
                  className="link link--muted tap"
                  style={{ display: 'flex', gap: 6, padding: 0, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}
                  onClick={() => setScopeOpen((o) => !o)}
                  aria-expanded={scopeOpen}
                >
                  <span>Permission on-chain</span>
                  <Icon name={scopeOpen ? 'up' : 'down'} size={13} />
                </button>
                {scopeOpen && (
                  <p
                    className="mono"
                    style={{ fontSize: 11.5, padding: 12, borderRadius: 'var(--r3)', background: 'var(--fill)', color: 'var(--muted)', margin: '0 0 6px' }}
                  >
                    {person.scopeId ?? 'Not granted yet'}
                  </p>
                )}
              </>
            ) : (
              <p className="hint">
                {person.name} has an account and nothing in it. Give them a limit
                and they can start spending straight away.
              </p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 18 }}>
              <button className="btn tap" onClick={() => setSheet('limits')}>
                {person.caps ? (person.revoked ? 'Turn spending back on' : 'Change limits') : 'Set limits'}
              </button>
              {person.caps && !person.revoked && (
                <button className="btn btn--quiet tap" onClick={() => setSheet('places')}>
                  Where {person.name} can pay
                </button>
              )}
              {/* Bound outside the handler: the JSX guard narrows `caps` here,
                  but not inside a closure that runs later. */}
              {person.caps && !person.revoked && ((caps) => (
                <button
                  className="btn btn--accent tap"
                  onClick={() => {
                    setSheet(null)
                    act({
                      title: `Turn off spending for ${person.name}`,
                      detail: [
                        { label: 'Stops', value: `${two(caps.perTx)} a purchase` },
                        { label: 'Frees up', value: `${two(caps.period)} ${st.symbol} a week` },
                        { label: 'Takes effect', value: 'Immediately, on-chain' },
                      ],
                      steps: ['Cancel the permission on-chain'],
                      quote: { action: 'revoke', memberId: person.id },
                      call: (auth) => api.post(`/api/members/${person.id}/revoke`, { auth }),
                    })
                  }}
                >
                  Turn off spending
                </button>
              ))(person.caps)}
            </div>
          </>
        )}
      </Sheet>

      {person && (
        <LimitsSheet
          // Remount per person: the draft fields seed from whoever's sheet
          // this is, and without a key they'd keep the last person's numbers.
          key={person.id}
          open={sheet === 'limits'}
          member={person}
          symbol={st.symbol}
          onBack={() => setSheet('person')}
          onSave={(perTx, period) => {
            setSheet(null)
            act({
              title: `Let ${person.name} spend ${two(perTx)} a purchase`,
              detail: [
                { label: 'Each purchase', value: `${two(perTx)} ${st.symbol} at most` },
                { label: 'Each week', value: `${two(period)} ${st.symbol} at most` },
                { label: 'Where', value: person.allowOnly ? `${person.allowed.length} places` : 'Anywhere' },
              ],
              steps: ['Write the limit on-chain'],
              quote: { action: 'grant', memberId: person.id, perTx, period },
              call: (auth) => api.post(`/api/members/${person.id}/grant`, { perTx, period, auth }),
            })
          }}
        />
      )}

      {person && (
        <PlacesSheet
          // Seeded from this person's saved list, so switching people does not
          // carry the last one's choices over.
          key={`${person.id}:${person.allowOnly}:${person.allowed.join(',')}`}
          open={sheet === 'places'}
          member={person}
          recipients={st.recipients}
          onBack={() => setSheet('person')}
          onSave={(only, allowed) => {
            setSheet(null)
            act({
              title: only
                ? `Let ${person.name} pay ${allowed.length} ${allowed.length === 1 ? 'place' : 'places'}`
                : `Let ${person.name} pay anyone`,
              detail: only
                ? [
                    { label: 'Can pay', value: `${allowed.length} ${allowed.length === 1 ? 'place' : 'places'}` },
                    { label: 'Anywhere else', value: 'Refused by the contract' },
                  ]
                : [{ label: 'Can pay', value: 'Any address, within their limit' }],
              steps: ['Write the list on-chain'],
              quote: { action: 'allowlist', memberId: person.id, only, allowed },
              call: (auth) => api.post(`/api/members/${person.id}/allowlist`, { only, allowed, auth }),
            })
          }}
        />
      )}

      {/* Mounted only while open: its body maps every recipient and, for each,
          scans the members holding it — all of it discarded on every poll
          while the sheet was closed. */}
      {sheet === 'book' && <BookSheet
        open
        st={st}
        onClose={() => setSheet(null)}
        act={act}
        reload={reload}
      />}
    </>
  )
}

/** One line under a name, so the restriction is visible without a tap. */
function status(m: Member, symbol: string): string {
  if (m.revoked) return 'Turned off'
  if (!m.caps) return 'No limits yet'
  const left = `${two(m.spendable)} ${symbol} left this week`
  return m.allowOnly
    ? `${left} · ${m.allowed.length} ${m.allowed.length === 1 ? 'place' : 'places'}`
    : left
}
