import { useState } from 'react'
import { api } from '../api'
import { createPasskey, unlockPasskey, webauthnAvailable } from '../webauthn'
import { Mark } from '../components/ui'

type Step = 'welcome' | 'names' | 'secure' | 'signin'

/**
 * First run. One decision per screen, and exactly one primary button on each —
 * the alternative is always a quiet text link underneath, never a second
 * button that competes with it.
 *
 * Setting up a family finishes in one pass: name it, then create the account.
 * The invite link is how *other people* join; the person starting the family
 * never has to touch one.
 */
export default function Onboarding({ onReady }: { onReady: () => void }) {
  const [step, setStep] = useState<Step>('welcome')
  const [famName, setFamName] = useState('')
  const [parentName, setParentName] = useState('')
  const [token, setToken] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [usePassphrase, setUsePassphrase] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const go = (s: Step) => { setErr(''); setUsePassphrase(false); setStep(s) }

  /** Reserve the family, keep its setup token, and move on to securing it. */
  const nameFamily = async () => {
    setErr(''); setBusy(true)
    try {
      const r = await api.post<{ joinPath: string }>('/api/family', { name: famName, parentName })
      setToken(r.joinPath.split('/').pop()!)
      setStep('secure')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start the family.')
    } finally { setBusy(false) }
  }

  const finish = async (body: Record<string, string>) => {
    const r = await api.post<{ credentialId: string }>(`/api/join/${token}`, body)
    localStorage.setItem('kin_credentialId', r.credentialId)
    onReady()
  }

  const createWithFaceId = async () => {
    setErr(''); setBusy(true)
    try {
      const pk = await createPasskey(parentName)
      if (!pk) { setUsePassphrase(true); return } // no PRF here — same vault, different key
      await finish({ credentialId: pk.credentialId, prfKeyHex: pk.prfKeyHex })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create your account.')
    } finally { setBusy(false) }
  }

  const createWithPassphrase = async () => {
    setErr(''); setBusy(true)
    try { await finish({ passphrase }) }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not create your account.') }
    finally { setBusy(false) }
  }

  const signInFaceId = async () => {
    setErr(''); setBusy(true)
    try {
      const pk = await unlockPasskey()
      if (!pk) throw new Error('This device could not use a passkey. Try your passphrase.')
      await api.post('/api/session', { credentialId: pk.credentialId, prfKeyHex: pk.prfKeyHex })
      onReady()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not sign in.')
    } finally { setBusy(false) }
  }

  const signInPassphrase = async () => {
    setErr(''); setBusy(true)
    try {
      const credentialId = localStorage.getItem('kin_credentialId')
      if (!credentialId) throw new Error("There's no account on this device yet.")
      await api.post('/api/session', { credentialId, passphrase })
      onReady()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not sign in.')
    } finally { setBusy(false) }
  }

  return (
    <div className={step === 'welcome' ? 'app app--splash' : 'app'}>
      {step !== 'welcome' && <header className="topbar"><span className="brand">kin<i>.</i></span></header>}

      {step === 'welcome' && (
        <div className="splash">
          <div className="splash__mark"><Mark size={52} /></div>
          <h1 className="splash__word">kin</h1>
          <p className="splash__line">Pocket money that can't go wrong.</p>

          <div className="splash__foot">
            <button className="btn btn--primary btn--block" onClick={() => go('names')}>Get started</button>
            <p className="center-row">
              Already set up? <button className="link" onClick={() => go('signin')}>Sign in</button>
            </p>
          </div>
        </div>
      )}

      {step === 'names' && (
        <>
          <p className="eyebrow">Step 1 of 2</p>
          <h1>Name your family.</h1>
          <p className="lede">So the people you invite know it's you.</p>
          <label>Family name</label>
          <input type="text" placeholder="The Riveras" value={famName} autoFocus
            onChange={(e) => setFamName(e.target.value)} />
          <label>Your first name</label>
          <input type="text" placeholder="Alex" value={parentName}
            onChange={(e) => setParentName(e.target.value)} />
          <button className="btn btn--primary btn--block" onClick={nameFamily} disabled={busy || !famName.trim() || !parentName.trim()}>
            {busy ? <><span className="spinner" />One moment…</> : 'Continue'}
          </button>
          <p className="center-row"><button className="link" onClick={() => go('welcome')}>Back</button></p>
        </>
      )}

      {step === 'secure' && (
        <>
          <p className="eyebrow">Step 2 of 2</p>
          <h1>Lock it to you, {parentName}.</h1>
          <p className="lede">
            Your face is the key. Nothing to write down, nothing to lose — and only this
            device can open it.
          </p>
          {!usePassphrase ? (
            <>
              <button className="btn btn--primary btn--block" onClick={createWithFaceId} disabled={busy}>
                {busy ? <><span className="spinner" />Setting up…</> : 'Use Face ID'}
              </button>
              {!webauthnAvailable() && (
                <p className="center-row center-row--dim">This browser has no Face ID — use a passphrase.</p>
              )}
              <p className="center-row">
                <button className="link" onClick={() => setUsePassphrase(true)}>Use a passphrase instead</button>
              </p>
            </>
          ) : (
            <>
              <label>Choose a passphrase</label>
              <input type="password" placeholder="At least 8 characters" value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)} autoFocus />
              <button className="btn btn--primary btn--block" onClick={createWithPassphrase} disabled={busy || passphrase.length < 8}>
                {busy ? <><span className="spinner" />Setting up…</> : 'Create my account'}
              </button>
              {webauthnAvailable() && (
                <p className="center-row">
                  <button className="link" onClick={() => setUsePassphrase(false)}>Use Face ID instead</button>
                </p>
              )}
            </>
          )}
        </>
      )}

      {step === 'signin' && (
        <>
          <h1>Welcome back.</h1>
          <p className="lede">Same face, same account.</p>
          {!usePassphrase ? (
            <>
              <button className="btn btn--primary btn--block" onClick={signInFaceId} disabled={busy}>
                {busy ? <><span className="spinner" />Opening…</> : 'Sign in with Face ID'}
              </button>
              <p className="center-row">
                <button className="link" onClick={() => setUsePassphrase(true)}>Use my passphrase</button>
              </p>
            </>
          ) : (
            <>
              <label>Your passphrase</label>
              <input type="password" value={passphrase} autoFocus
                onChange={(e) => setPassphrase(e.target.value)} />
              <button className="btn btn--primary btn--block" onClick={signInPassphrase} disabled={busy || passphrase.length < 8}>
                {busy ? <><span className="spinner" />Opening…</> : 'Sign in'}
              </button>
              <p className="center-row">
                <button className="link" onClick={() => setUsePassphrase(false)}>Use Face ID</button>
              </p>
            </>
          )}
          <p className="center-row"><button className="link" onClick={() => go('welcome')}>Back</button></p>
        </>
      )}

      {err && <div className="note note--err" role="alert">{err}</div>}
    </div>
  )
}
