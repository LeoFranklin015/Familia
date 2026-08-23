import { useState } from 'react'
import { api } from '../../api'
import { Sheet } from '../../components/Sheet'

/* ── invite ──────────────────────────────────────────────────────────────── */

export function InviteSheet({
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
