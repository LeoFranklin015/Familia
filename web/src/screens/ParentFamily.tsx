import { useState } from 'react'
import { api, type ParentState, type Recipient } from '../api'
import { Sheet } from '../components/Sheet'
import { Icon, KindIcon, shortAddress, two } from '../components/ui'
import { resetDay } from './Activity'
import type { Act } from './Parent'

type Member = ParentState['members'][number]
type Which = 'invite' | 'person' | 'limits' | 'allow' | null

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
          <button className="btn btn--quiet tap" onClick={() => setSheet('allow')}>
            Who the family can pay
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

      <AllowSheet
        open={sheet === 'allow'}
        st={st}
        act={act}
        onClose={() => setSheet(null)}
        reload={reload}
      />
    </>
  )
}

function status(m: Member, symbol: string): string {
  if (m.revoked) return 'Turned off'
  if (!m.caps) return 'No limits yet'
  return `${two(m.spendable)} ${symbol} left this week`
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

/* ── who the family can pay ──────────────────────────────────────────────── */

/**
 * The recipient book, and the switch that turns it into a rule.
 *
 * Editing the list is free and instant while it is only a convenience. The
 * moment "only this list" is on, the same edits are real on-chain writes
 * across every active scope — so the sheet says which mode it is in, and the
 * cost follows from that rather than from which button was pressed.
 */
function AllowSheet({
  open, st, act, onClose, reload,
}: {
  open: boolean
  st: ParentState
  act: Act
  onClose: () => void
  reload: () => Promise<void>
}) {
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // Whether a change reaches the chain at all: only if the book is a rule and
  // there is at least one live permission for it to bind.
  const live = st.members.some((m) => m.scopeId && !m.revoked)
  const enforcedEdit = st.allowOnly && live

  /** A book edit that costs nothing — no key, no operation, no waiting. */
  const localEdit = async (path: string, body: Record<string, unknown>) => {
    setErr(''); setBusy(true)
    try {
      await api.post(path, body)
      await reload()
      setName(''); setAddress('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That did not work.')
    } finally { setBusy(false) }
  }

  /** The same edit, when it has to be written on-chain first. */
  const signedEdit = (title: string, steps: string[], path: string, body: Record<string, unknown>) => {
    onClose()
    act({
      title, steps,
      quote: { action: 'allowlist', only: st.allowOnly },
      call: async (auth) => {
        const r = await api.post<{ txHash?: string; feeCharged?: string | null }>(path, { ...body, auth })
        return r
      },
    })
  }

  const add = () => {
    const body = { name, address, kind: 'PERSON' as const }
    if (enforcedEdit) {
      signedEdit(`Let the family pay ${name}`, ['Write the list on-chain'], '/api/recipients', body)
    } else {
      void localEdit('/api/recipients', body)
    }
  }

  const remove = (r: Recipient) => {
    if (enforcedEdit) {
      signedEdit(`Stop the family paying ${r.name}`, ['Write the list on-chain'], `/api/recipients/${r.id}/remove`, {})
    } else {
      void localEdit(`/api/recipients/${r.id}/remove`, {})
    }
  }

  const toggle = () => {
    const only = !st.allowOnly
    if (!live) { void localEdit('/api/allowlist', { only }); return }
    onClose()
    act({
      title: only ? 'Only pay this list' : 'Let the family pay anyone',
      steps: ['Write the list on-chain'],
      quote: { action: 'allowlist', only },
      call: (auth) => api.post('/api/allowlist', { only, auth }),
    })
  }

  return (
    <Sheet open={open} title="Who the family can pay" onClose={onClose}>
      <button
        className="tap"
        onClick={toggle}
        aria-pressed={st.allowOnly}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 12,
          minHeight: 58, padding: '0 16px', borderRadius: 'var(--r2)',
          border: `1px solid ${st.allowOnly ? 'var(--accent)' : 'var(--line)'}`,
          background: st.allowOnly ? 'rgb(95 211 163 / 0.09)' : 'transparent',
          textAlign: 'left', marginBottom: 14,
        }}
      >
        <span
          style={{
            width: 22, height: 22, flex: 'none', borderRadius: 7,
            border: `1.5px solid ${st.allowOnly ? 'var(--accent)' : 'var(--line)'}`,
            background: st.allowOnly ? 'var(--accent)' : 'transparent',
            display: 'grid', placeItems: 'center', color: 'var(--ink)',
          }}
        >
          {st.allowOnly && <Icon name="check" size={13} />}
        </span>
        <span style={{ flex: 1 }}>
          <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>Only this list</span>
          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)' }}>
            {st.allowOnly
              ? 'Payments to anyone else are refused on-chain'
              : 'Anyone with an address can be paid'}
          </span>
        </span>
      </button>

      {st.recipients.map((r) => (
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
            </span>
          </span>
          <button
            className="link tap"
            style={{ fontSize: 12.5 }}
            disabled={busy}
            onClick={() => remove(r)}
          >
            Remove
          </button>
        </div>
      ))}

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
            Check a pasted address twice. Anything on this list can be paid, and
            a payment can&rsquo;t be called back.
          </p>
        </div>

        {err && <p className="warn mt2" role="alert">{err}</p>}

        <button
          className="btn tap mt3"
          disabled={busy || !name.trim() || !/^0x[0-9a-fA-F]{40}$/.test(address.trim())}
          onClick={add}
        >
          {busy ? <><span className="spin" />Adding…</> : 'Add to the list'}
        </button>
        {enforcedEdit && (
          <p className="note mt2" style={{ textAlign: 'center' }}>
            The list is being enforced, so this goes on-chain.
          </p>
        )}
      </div>
    </Sheet>
  )
}
