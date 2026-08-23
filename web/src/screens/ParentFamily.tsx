import { useState } from 'react'
import { api, type ParentState, type Recipient } from '../api'
import { Sheet } from '../components/Sheet'
import { Icon, KindIcon, shortAddress, two } from '../components/ui'
import { resetDay } from './Activity'
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
              {person.caps && !person.revoked && (
                <button
                  className="btn btn--accent tap"
                  onClick={() => {
                    setSheet(null)
                    act({
                      title: `Turn off spending for ${person.name}`,
                      steps: ['Cancel the permission on-chain'],
                      quote: { action: 'revoke', memberId: person.id },
                      call: (auth) => api.post(`/api/members/${person.id}/revoke`, { auth }),
                    })
                  }}
                >
                  Turn off spending
                </button>
              )}
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
              steps: ['Write the list on-chain'],
              quote: { action: 'allowlist', memberId: person.id, only, allowed },
              call: (auth) => api.post(`/api/members/${person.id}/allowlist`, { only, allowed, auth }),
            })
          }}
        />
      )}

      <BookSheet
        open={sheet === 'book'}
        st={st}
        onClose={() => setSheet(null)}
        act={act}
        reload={reload}
      />
    </>
  )
}

function status(m: Member, symbol: string): string {
  if (m.revoked) return 'Turned off'
  if (!m.caps) return 'No limits yet'
  const left = `${two(m.spendable)} ${symbol} left this week`
  return m.allowOnly
    ? `${left} · ${m.allowed.length} ${m.allowed.length === 1 ? 'place' : 'places'}`
    : left
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'accent' }) {
  return (
    <div className="dl__row">
      <dt>{label}</dt>
      <dd style={tone === 'accent' ? { color: 'var(--accent)' } : undefined}>{value}</dd>
    </div>
  )
}

/* ── one ask ─────────────────────────────────────────────────────────────── */

function Ask({ r, act }: { r: ParentState['pendingRequests'][number]; act: Act }) {
  const settle = (verdict: 'approve' | 'deny') => act({
    title: verdict === 'approve'
      ? `Pay ${r.amount} to ${r.toName} for ${r.memberName}`
      : `Turn down ${r.memberName}'s ${r.amount}`,
    steps: verdict === 'approve'
      ? ['Take it out of Aave', `Send it to ${r.toName}`]
      : ['Turn down the ask on-chain'],
    quote: { action: 'settle', requestId: r.requestId, verdict },
    call: (auth) => api.post(`/api/requests/${r.requestId}/${verdict}`, { auth }),
  })

  return (
    <div className="ask">
      <div className="ask__text">{r.memberName} wants to pay {r.amount} at {r.toName}.</div>
      <div className="ask__at">Asked {r.createdAt ? relative(r.createdAt) : 'just now'}</div>
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

function relative(at: number): string {
  const mins = Math.round((Date.now() - at) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  return 'a while ago'
}

/* ── limits ──────────────────────────────────────────────────────────────── */

function LimitsSheet({
  open, member, symbol, onBack, onSave,
}: {
  open: boolean
  member: Member
  symbol: string
  onBack: () => void
  onSave: (perTx: string, period: string) => void
}) {
  const [perTx, setPerTx] = useState(() => two(member.caps?.perTx ?? '5'))
  const [period, setPeriod] = useState(() => two(member.caps?.period ?? '25'))

  // Plain money, at most two decimals. Anything else reaches parseUnits on the
  // server and comes back as an untranslated 500.
  const clean = (v: string) => /^\d{1,7}(\.\d{1,2})?$/.test(v.trim())
  const wellFormed = clean(perTx) && clean(period)
  const ok = wellFormed && Number(perTx) > 0 && Number(period) >= Number(perTx)

  return (
    <Sheet open={open} title={`${member.name}'s limits`} onClose={onBack} back>
      <label className="field">
        <span>Most per purchase</span>
        <input
          className="input num" inputMode="decimal" value={perTx}
          onChange={(e) => setPerTx(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Most per week</span>
        <input
          className="input num" inputMode="decimal" value={period}
          onChange={(e) => setPeriod(e.target.value)}
        />
      </label>

      <p className="hint mt3">
        The contract holds these, not the app. Anything over them turns into a
        request for you. It doesn&rsquo;t fail.
      </p>
      {!wellFormed && (perTx.trim() || period.trim()) && (
        <p className="warn mt2">Amounts only, up to two decimal places.</p>
      )}
      {wellFormed && !ok && Number(perTx) > 0 && (
        <p className="warn mt2">A week has to allow at least one purchase.</p>
      )}

      <button className="btn tap mt4" disabled={!ok} onClick={() => onSave(perTx, period)}>
        Save limits
      </button>
      <p className="note mt2" style={{ textAlign: 'center' }}>{symbol}, per person</p>
    </Sheet>
  )
}

/* ── invite ──────────────────────────────────────────────────────────────── */

function InviteSheet({
  open, onClose, onCopied,
}: {
  open: boolean
  onClose: () => void
  onCopied: (m: string) => void
}) {
  const [name, setName] = useState('')
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const create = async () => {
    setErr(''); setBusy(true)
    try {
      const r = await api.post<{ joinPath: string }>('/api/invites', { name })
      setLink(`${location.origin}${r.joinPath}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not make a link.')
    } finally { setBusy(false) }
  }

  const close = () => { setName(''); setLink(''); setErr(''); onClose() }

  return (
    <Sheet open={open} title="Invite someone" onClose={close}>
      {!link ? (
        <>
          <label className="field">
            <span>Their first name</span>
            <input
              className="input" value={name} placeholder="Maya"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <p className="hint mt3">
            You&rsquo;ll get a link to send them. It works once, carries no money
            and no key, and their account exists the moment they tap it.
          </p>
          {err && <p className="warn mt2" role="alert">{err}</p>}
          <button className="btn tap mt4" disabled={busy || !name.trim()} onClick={create}>
            {busy ? <><span className="spin" />Making it…</> : 'Create the link'}
          </button>
        </>
      ) : (
        <>
          <p className="hint" style={{ color: 'var(--body)', marginBottom: 10 }}>Send this to {name}.</p>
          <p
            className="mono"
            style={{
              padding: 14, borderRadius: 'var(--r3)', margin: 0,
              background: 'rgb(95 211 163 / 0.1)', border: '1px solid rgb(95 211 163 / 0.22)',
              fontSize: 12.5, color: 'var(--accent)',
            }}
          >
            {link}
          </p>
          <button
            className="btn tap mt3"
            onClick={async () => {
              try { await navigator.clipboard.writeText(link); onCopied('Link copied') }
              catch { onCopied("Couldn't copy") }
            }}
          >
            Copy the link
          </button>
          <button className="btn btn--quiet tap mt2" onClick={close}>Done</button>
        </>
      )}
    </Sheet>
  )
}

/* ── the address book ────────────────────────────────────────────────────── */

/**
 * Names against addresses, shared by the household.
 *
 * Editing this permits nothing on its own, so it is free and instant. An
 * address only becomes payable when someone's own list includes it, which is
 * the sheet below.
 */
function BookSheet({
  open, st, onClose, act, reload,
}: {
  open: boolean
  st: ParentState
  onClose: () => void
  act: Act
  reload: () => Promise<void>
}) {
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const add = async () => {
    setErr(''); setBusy(true)
    try {
      await api.post('/api/recipients', { name, address, kind: 'PERSON' })
      await reload()
      setName(''); setAddress('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That did not work.')
    } finally { setBusy(false) }
  }

  /** Who currently has this address on their list. */
  const heldBy = (addr: string) => st.members.filter(
    (m) => m.allowOnly && m.allowed.some((a) => a.toLowerCase() === addr.toLowerCase()),
  )

  const remove = (r: Recipient) => {
    const holders = heldBy(r.address)
    if (holders.length === 0) {
      void (async () => {
        setBusy(true)
        try { await api.post(`/api/recipients/${r.id}/remove`, {}); await reload() }
        finally { setBusy(false) }
      })()
      return
    }
    onClose()
    act({
      title: `Remove ${r.name}`,
      steps: [`Take it off ${holders.length} ${holders.length === 1 ? 'list' : 'lists'} on-chain`],
      call: (auth) => api.post(`/api/recipients/${r.id}/remove`, { auth }),
    })
  }

  return (
    <Sheet open={open} title="Address book" onClose={onClose}>
      <p className="hint" style={{ marginBottom: 14 }}>
        Names for addresses, so nobody types hex twice. Saving one here lets
        nobody pay it — that is set per person, under their name.
      </p>

      {st.recipients.map((r) => {
        const holders = heldBy(r.address)
        return (
          <div
            key={r.id}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderTop: '1px solid var(--line)' }}
          >
            <span className="avatar avatar--sm" style={{ background: 'var(--fill-2)', color: 'var(--muted)', borderColor: 'transparent' }}>
              <KindIcon kind={r.kind} size={16} />
            </span>
            <span className="row__body">
              <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>{r.name}</span>
              <span className="num" style={{ display: 'block', fontSize: 11, color: 'var(--faint)' }}>
                {shortAddress(r.address)}
                {holders.length > 0 && ` · ${holders.map((m) => m.name).join(', ')}`}
              </span>
            </span>
            <button className="link tap" style={{ fontSize: 12.5 }} disabled={busy} onClick={() => remove(r)}>
              Remove
            </button>
          </div>
        )
      })}

      <div style={{ marginTop: 18 }}>
        <label className="field">
          <span>Name</span>
          <input className="input" value={name} placeholder="Nan" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Their address</span>
          <input
            className="input num" value={address} placeholder="0x…" spellCheck={false}
            autoCapitalize="off" autoComplete="off"
            onChange={(e) => setAddress(e.target.value)}
          />
        </label>

        <div className="callout mt3">
          <Icon name="warning" size={18} />
          <p className="note" style={{ color: 'var(--warn)' }}>
            Check a pasted address twice. A payment cannot be called back.
          </p>
        </div>

        {err && <p className="warn mt2" role="alert">{err}</p>}

        <button
          className="btn tap mt3"
          disabled={busy || !name.trim() || !/^0x[0-9a-fA-F]{40}$/.test(address.trim())}
          onClick={add}
        >
          {busy ? <><span className="spin" />Adding…</> : 'Add to the book'}
        </button>
      </div>
    </Sheet>
  )
}

/* ── where one person can pay ────────────────────────────────────────────── */

/**
 * One member's allowlist.
 *
 * This is the shape the contract actually holds: `allowlist[scopeId][address]`,
 * one list per scope, and a scope belongs to one person. So a nine-year-old
 * can be held to the corner shop while a teenager is not — which a
 * household-wide list could never express.
 */
function PlacesSheet({
  open, member, recipients, onBack, onSave,
}: {
  open: boolean
  member: Member
  recipients: Recipient[]
  onBack: () => void
  onSave: (only: boolean, allowed: string[]) => void
}) {
  const [only, setOnly] = useState(member.allowOnly)
  const [picked, setPicked] = useState<string[]>(member.allowed)

  const has = (a: string) => picked.some((p) => p.toLowerCase() === a.toLowerCase())
  const toggle = (a: string) =>
    setPicked((p) => (has(a) ? p.filter((x) => x.toLowerCase() !== a.toLowerCase()) : [...p, a]))

  const changed = only !== member.allowOnly
    || picked.length !== member.allowed.length
    || picked.some((p) => !member.allowed.some((a) => a.toLowerCase() === p.toLowerCase()))

  return (
    <Sheet open={open} title={`Where ${member.name} can pay`} onClose={onBack} back>
      <button
        className="tap"
        onClick={() => setOnly((o) => !o)}
        aria-pressed={only}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 12,
          minHeight: 58, padding: '0 16px', borderRadius: 'var(--r2)',
          border: `1px solid ${only ? 'var(--accent)' : 'var(--line)'}`,
          background: only ? 'rgb(95 211 163 / 0.09)' : 'transparent',
          textAlign: 'left', marginBottom: 14,
        }}
      >
        <span
          style={{
            width: 22, height: 22, flex: 'none', borderRadius: 7,
            border: `1.5px solid ${only ? 'var(--accent)' : 'var(--line)'}`,
            background: only ? 'var(--accent)' : 'transparent',
            display: 'grid', placeItems: 'center', color: 'var(--ink)',
          }}
        >
          {only && <Icon name="check" size={13} />}
        </span>
        <span style={{ flex: 1 }}>
          <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>Only these places</span>
          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)' }}>
            {only
              ? 'Anywhere else is refused on-chain'
              : `${member.name} can pay any address`}
          </span>
        </span>
      </button>

      {only && (
        recipients.length > 0 ? (
          recipients.map((r) => (
            <button
              key={r.id}
              className="tap"
              onClick={() => toggle(r.address)}
              aria-pressed={has(r.address)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                padding: '11px 0', borderTop: '1px solid var(--line)',
                background: 'none', border: 0, borderTopStyle: 'solid', textAlign: 'left',
              }}
            >
              <span
                style={{
                  width: 22, height: 22, flex: 'none', borderRadius: 7,
                  border: `1.5px solid ${has(r.address) ? 'var(--accent)' : 'var(--line)'}`,
                  background: has(r.address) ? 'var(--accent)' : 'transparent',
                  display: 'grid', placeItems: 'center', color: 'var(--ink)',
                }}
              >
                {has(r.address) && <Icon name="check" size={13} />}
              </span>
              <span className="avatar avatar--sm" style={{ background: 'var(--fill-2)', color: 'var(--muted)', borderColor: 'transparent' }}>
                <KindIcon kind={r.kind} size={16} />
              </span>
              <span className="row__body">
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>{r.name}</span>
                <span className="num" style={{ display: 'block', fontSize: 11, color: 'var(--faint)' }}>
                  {shortAddress(r.address)}
                </span>
              </span>
            </button>
          ))
        ) : (
          <p className="empty">Nothing in the address book yet. Add somewhere first.</p>
        )
      )}

      <p className="hint mt3">
        The contract holds this list, not the app. A payment anywhere else is
        refused on-chain, whatever this screen says.
      </p>

      <button
        className="btn tap mt4"
        disabled={!changed || (only && picked.length === 0)}
        onClick={() => onSave(only, picked)}
      >
        {only && picked.length === 0 ? 'Pick at least one place' : 'Save'}
      </button>
    </Sheet>
  )
}
