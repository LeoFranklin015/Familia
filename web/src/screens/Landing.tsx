import { useState } from 'react'
import { api, ApiError } from '../api'
import { unlockPasskey, webauthnAvailable } from '../webauthn'

export default function Landing({ onUnlocked }: { onUnlocked: () => void }) {
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'unlock' | 'passphrase' | 'create'>('unlock')
  const [passphrase, setPassphrase] = useState('')
  const [famName, setFamName] = useState('')
  const [parentName, setParentName] = useState('')
  const [joinPath, setJoinPath] = useState('')

  const unlock = async () => {
    setErr(''); setBusy(true)
    try {
      const pk = await unlockPasskey()
      if (!pk) throw new Error('This device could not unlock with a passkey — try the passphrase.')
      await api.post('/api/session', { credentialId: pk.credentialId, prfKeyHex: pk.prfKeyHex })
      onUnlocked()
    } catch (e) {
      setErr(e instanceof ApiError || e instanceof Error ? e.message : 'Could not unlock.')
    } finally {
      setBusy(false)
    }
  }

  const unlockPass = async () => {
    setErr(''); setBusy(true)
    try {
      const credentialId = localStorage.getItem('kin_credentialId')
      if (!credentialId) throw new Error('No saved account on this browser — use your invite link.')
      await api.post('/api/session', { credentialId, passphrase })
      onUnlocked()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not unlock.')
    } finally {
      setBusy(false)
    }
  }

  const createFamily = async () => {
    setErr(''); setBusy(true)
    try {
      const r = await api.post<{ joinPath: string }>('/api/family', { name: famName, parentName })
      setJoinPath(r.joinPath)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create the family.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="topbar"><span className="brand">kin<span className="dot">.</span></span></div>
      <h1>One pot, everyone spends safely.</h1>
      <p className="sub">Family money that earns while it waits, with limits that live on-chain.</p>

      {mode === 'unlock' && (
        <div className="card stack">
          {webauthnAvailable() && (
            <button className="primary" onClick={unlock} disabled={busy}>
              {busy ? <><span className="spinner" />Unlocking…</> : 'Unlock with Face ID / passkey'}
            </button>
          )}
          <button className="mini" onClick={() => setMode('passphrase')}>Use passphrase instead</button>
          <button className="mini" onClick={() => setMode('create')}>Start a new family</button>
        </div>
      )}

      {mode === 'passphrase' && (
        <div className="card">
          <label>Your passphrase</label>
          <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
          <button className="primary" onClick={unlockPass} disabled={busy || passphrase.length < 8}>
            {busy ? <><span className="spinner" />Unlocking…</> : 'Unlock'}
          </button>
          <button className="mini" style={{ marginTop: 10 }} onClick={() => setMode('unlock')}>Back</button>
        </div>
      )}

      {mode === 'create' && !joinPath && (
        <div className="card">
          <label>Family name</label>
          <input type="text" value={famName} onChange={(e) => setFamName(e.target.value)} placeholder="The Riveras" />
          <label>Your name</label>
          <input type="text" value={parentName} onChange={(e) => setParentName(e.target.value)} placeholder="Alex" />
          <button className="primary" onClick={createFamily} disabled={busy || !famName || !parentName}>
            Create family
          </button>
          <button className="mini" style={{ marginTop: 10 }} onClick={() => setMode('unlock')}>Back</button>
        </div>
      )}

      {joinPath && (
        <div className="card">
          <h2>Family created</h2>
          <p className="sub" style={{ marginBottom: 0 }}>Open your own invite to set up Face ID:</p>
          <a href={joinPath}><div className="linkbox">{location.origin}{joinPath}</div></a>
        </div>
      )}

      {err && <div className="note err">{err}</div>}
    </div>
  )
}
