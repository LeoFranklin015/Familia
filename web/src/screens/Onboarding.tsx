import { useState } from 'react'
import { api } from '../api'
import { createPasskey, unlockPasskey, webauthnAvailable } from '../webauthn'

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
    <div className="onboard">
      <div className="topbar"><span className="brand">kin<span className="dot">.</span></span></div>

      {step === 'welcome' && (
        <>
          <h1>Pocket money that can't go wrong.</h1>
          <p className="sub">
            One pot the family shares. You decide what each person can spend, and the
            limits hold on their own — no card to cancel, no app for them to install.
          </p>
          <ol className="steps">
            <li><b>Put money in the pot.</b> It stays in your own account.</li>
            <li><b>Send a link.</b> One tap and they're ready.</li>
            <li><b>They just pay.</b> Within your limits it goes straight through.</li>
          </ol>
          <button className="primary" onClick={() => go('names')}>Start a family</button>
          <p className="alt">
            Already set up? <button className="link" onClick={() => go('signin')}>Sign in</button>
          </p>
          <p className="alt dim">Been sent an invite? Just open that link.</p>
        </>
      )}

      {step === 'names' && (
        <>
          <p className="crumb">Step 1 of 2</p>
          <h1>Name your family.</h1>
          <p className="sub">So the people you invite know it's you.</p>
          <label>Family name</label>
          <input type="text" placeholder="The Riveras" value={famName} autoFocus
            onChange={(e) => setFamName(e.target.value)} />
          <label>Your first name</label>
          <input type="text" placeholder="Alex" value={parentName}
            onChange={(e) => setParentName(e.target.value)} />
          <button className="primary" onClick={nameFamily} disabled={busy || !famName.trim() || !parentName.trim()}>
            {busy ? <><span className="spinner" />One moment…</> : 'Continue'}
          </button>
          <p className="alt"><button className="link" onClick={() => go('welcome')}>Back</button></p>
        </>
      )}

      {step === 'secure' && (
        <>
          <p className="crumb">Step 2 of 2</p>
          <h1>Lock it to you, {parentName}.</h1>
          <p className="sub">
            Your face is the key. Nothing to write down, nothing to lose — and only this
            device can open the pot.
          </p>
          {!usePassphrase ? (
            <>
              <button className="primary" onClick={createWithFaceId} disabled={busy}>
                {busy ? <><span className="spinner" />Setting up…</> : 'Use Face ID'}
              </button>
              {!webauthnAvailable() && (
                <p className="alt dim">This browser has no Face ID — use a passphrase.</p>
              )}
              <p className="alt">
                <button className="link" onClick={() => setUsePassphrase(true)}>Use a passphrase instead</button>
              </p>
            </>
          ) : (
            <>
              <label>Choose a passphrase</label>
              <input type="password" placeholder="At least 8 characters" value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)} autoFocus />
              <button className="primary" onClick={createWithPassphrase} disabled={busy || passphrase.length < 8}>
                {busy ? <><span className="spinner" />Setting up…</> : 'Create my account'}
              </button>
              {webauthnAvailable() && (
                <p className="alt">
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
          <p className="sub">Same face, same account.</p>
          {!usePassphrase ? (
            <>
              <button className="primary" onClick={signInFaceId} disabled={busy}>
                {busy ? <><span className="spinner" />Opening…</> : 'Sign in with Face ID'}
              </button>
              <p className="alt">
                <button className="link" onClick={() => setUsePassphrase(true)}>Use my passphrase</button>
              </p>
            </>
          ) : (
            <>
              <label>Your passphrase</label>
              <input type="password" value={passphrase} autoFocus
                onChange={(e) => setPassphrase(e.target.value)} />
              <button className="primary" onClick={signInPassphrase} disabled={busy || passphrase.length < 8}>
                {busy ? <><span className="spinner" />Opening…</> : 'Sign in'}
              </button>
              <p className="alt">
                <button className="link" onClick={() => setUsePassphrase(false)}>Use Face ID</button>
              </p>
            </>
          )}
          <p className="alt"><button className="link" onClick={() => go('welcome')}>Back</button></p>
        </>
      )}

      {err && <div className="note err">{err}</div>}
    </div>
  )
}
