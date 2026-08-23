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
    <div className={step === 'welcome' ? 'app app--splash' : 'app'}>
      {step !== 'welcome' && <header className="topbar"><span className="brand">kin<i>.</i></span></header>}

      {step === 'welcome' && (
        <div className="splash">
          {/* Show the thing, don't describe it: two cards from the real app,
              stacked and tilted the way they'd sit in a hand. */}
          <div className="preview" aria-hidden="true">
            <div className="preview__card preview__card--back">
              <div className="preview__row">
                <span className="preview__avatar" style={{ background: '#e7f2eb', color: '#0f5230' }}>S</span>
                <div>
                  <div className="preview__name">Sam</div>
                  <div className="preview__sub">42 left this week</div>
                </div>
                <span className="preview__pill">on</span>
              </div>
            </div>

            <div className="preview__card preview__card--front">
              <div className="preview__label">Family balance</div>
              <div className="preview__figure">500<span>USD₮</span></div>
              <div className="preview__bar"><i /></div>
            </div>
          </div>

          <h1 className="splash__word">Pocket money that can&rsquo;t go wrong</h1>
          <p className="splash__line">
            One balance the family shares. You set what each person can spend, and the
            limits hold on their own.
          </p>

          <div className="splash__foot">
            <button className="btn btn--primary btn--block btn--lg" onClick={() => go('names')}>
              Get started
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 12h15M13 6l6 6-6 6" />
              </svg>
            </button>
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
