import { useState } from 'react'
import { Sheet } from '../../components/Sheet'
import { Check, RecipientRow } from './rows'
import type { ParentState, Recipient } from '../../api'

type Member = ParentState['members'][number]

/* ── where one person can pay ────────────────────────────────────────────── */

/**
 * One member's allowlist.
 *
 * This is the shape the contract actually holds: `allowlist[scopeId][address]`,
 * one list per scope, and a scope belongs to one person. So a nine-year-old
 * can be held to the corner shop while a teenager is not — which a
 * household-wide list could never express.
 */
export function PlacesSheet({
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
        <Check on={only} />
        <span style={{ flex: 1 }}>
          <span className="recipient__name">Only these places</span>
          <span className="recipient__addr">
            {only
              ? 'Anywhere else is refused on-chain'
              : `${member.name} can pay any address`}
          </span>
        </span>
      </button>

      {only && (
        recipients.length > 0 ? (
          recipients.map((r) => (
            <RecipientRow
              key={r.id}
              recipient={r}
              picked={has(r.address)}
              onPick={() => toggle(r.address)}
            />
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
