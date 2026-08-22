import { useState } from 'react'
import { api } from '../api'
import { unlockPasskey, webauthnAvailable } from '../webauthn'

type Step = 'welcome' | 'name' | 'created' | 'unlock'

/**
 * First run. Three ideas, one screen each: what this is, who you are, and the
 * link that turns into an account. No wallet vocabulary anywhere — the person
 * setting this up is a parent, not a crypto user.
 */
export default function Onboarding({ onReady }: { onReady: () => void }) {
  const [step, setStep] = useState<Step>('welcome')
  const [famName, setFamName] = useState('')
  const [parentName, setParentName] = useState('')
  const [joinPath, setJoinPath] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const create = async () => {
    setErr(''); setBusy(true)
    try {
      const r = await api.post<{ joinPath: string }>('/api/family', { name: famName, parentName })
      setJoinPath(r.joinPath)
      setStep('created')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create the family.')
    } finally { setBusy(false) }
  }

  const unlockWithPasskey = async () => {
    setErr(''); setBusy(true)
    try {
      const pk = await unlockPasskey()
      if (!pk) throw new Error('This device could not use a passkey. Use your passphrase.')
      await api.post('/api/session', { credentialId: pk.credentialId, prfKeyHex: pk.prfKeyHex })
      onReady()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not unlock.')
    } finally { setBusy(false) }
  }

  const unlockWithPassphrase = async () => {
    setErr(''); setBusy(true)
    try {
      const credentialId = localStorage.getItem('kin_credentialId')
      if (!credentialId) throw new Error('No account on this device. Open your invite link instead.')
      await api.post('/api/session', { credentialId, passphrase })
      onReady()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not unlock.')
    } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="topbar"><span className="brand">kin<span className="dot">.</span></span></div>

      {step === 'welcome' && (
        <>
          <h1>Pocket money that can't go wrong.</h1>
          <p className="sub">
            One pot the family shares. You set what each person can spend; the limits are
            enforced by the network, not by trust. Nobody needs an app, a card, or anything
            explained to them.
          </p>
          <ol className="steps">
            <li><b>Put money in the pot.</b> It stays yours the whole time.</li>
            <li><b>Send a link.</b> They tap it once and they're set up.</li>
            <li><b>They just pay.</b> Inside your limits, it goes through.</li>
          </ol>
          <button className="primary" onClick={() => setStep('name')}>Set up my family</button>
          <button className="mini wide" onClick={() => setStep('unlock')}>I already have an account</button>
        </>
      )}

      {step === 'name' && (
        <>
          <h1>Who's this for?</h1>
          <p className="sub">Just so the people you invite recognise it.</p>
          <div className="card">
            <label>Family name</label>
            <input type="text" placeholder="The Riveras" value={famName}
              onChange={(e) => setFamName(e.target.value)} autoFocus />
            <label>Your name</label>
            <input type="text" placeholder="Alex" value={parentName}
              onChange={(e) => setParentName(e.target.value)} />
            <button className="primary" onClick={create} disabled={busy || !famName || !parentName}>
              {busy ? <><span className="spinner" />Creating…</> : 'Continue'}
            </button>
          </div>
          <button className="mini wide" onClick={() => setStep('welcome')}>Back</button>
        </>
      )}

      {step === 'created' && (
        <>
          <h1>One last tap.</h1>
          <p className="sub">
            Open this to finish setting up your own account with Face ID. It's the same kind
            of link you'll send everyone else.
          </p>
          <a className="primary block" href={joinPath}>Finish setup</a>
          <div className="linkbox">{location.origin}{joinPath}</div>
        </>
      )}

      {step === 'unlock' && (
        <>
          <h1>Welcome back.</h1>
          <div className="card stack">
            {webauthnAvailable() && (
              <button className="primary" onClick={unlockWithPasskey} disabled={busy}>
                {busy ? <><span className="spinner" />Unlocking…</> : 'Unlock with Face ID'}
              </button>
            )}
            <label>Or your passphrase</label>
            <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
            <button className="mini wide" onClick={unlockWithPassphrase} disabled={busy || passphrase.length < 8}>
              Unlock with passphrase
            </button>
            <button className="mini wide" onClick={() => setStep('welcome')}>Back</button>
          </div>
        </>
      )}

      {err && <div className="note err">{err}</div>}
    </div>
  )
}
