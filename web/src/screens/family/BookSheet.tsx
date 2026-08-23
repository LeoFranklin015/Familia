import { useState } from 'react'
import { api, type ParentState, type Recipient } from '../../api'
import { Sheet } from '../../components/Sheet'
import { Icon } from '../../components/ui'
import { shortAddress } from '../../lib/address'
import { RecipientRow } from './rows'
import type { Act } from '../Parent'

/* ── the address book ────────────────────────────────────────────────────── */

/**
 * Names against addresses, shared by the household.
 *
 * Editing this permits nothing on its own, so it is free and instant. An
 * address only becomes payable when someone's own list includes it, which is
 * the sheet below.
 */
export function BookSheet({
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
      detail: [
        { label: 'Address', value: shortAddress(r.address) },
        { label: 'Comes off', value: `${holders.length} ${holders.length === 1 ? 'list' : 'lists'}` },
        { label: 'Who is affected', value: holders.map((m) => m.name).join(', ') },
      ],
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
          <RecipientRow
            key={r.id}
            recipient={r}
            note={holders.length ? holders.map((m) => m.name).join(', ') : undefined}
            action={
              <button className="link tap link--sm" disabled={busy} onClick={() => remove(r)}>
                Remove
              </button>
            }
          />
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
