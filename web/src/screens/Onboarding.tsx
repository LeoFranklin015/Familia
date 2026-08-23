import { useState } from 'react'
import { api } from '../api'
import { createPasskey, unlockPasskey, webauthnAvailable } from '../webauthn'
import { Blob, Icon } from '../components/ui'

type Step = 'welcome' | 'names' | 'secure' | 'signin'

/**
 * First run. One decision per screen, and exactly one filled button on each —
 * the alternative is always a quiet outlined one underneath, never a second
 * button competing for the same attention.
 *
 * Setting up a household finishes in one pass: name it, then make the account.
 * Invite links are how *other people* join; whoever starts it never sees one.
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

  /** Reserve the household, keep its setup token, and move on to securing it. */
  const nameFamily = async () => {
    setErr(''); setBusy(true)
    try {
      const r = await api.post<{ joinPath: string }>('/api/family', { name: famName, parentName })
      setToken(r.joinPath.split('/').pop()!)
      setStep('secure')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start the household.')
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
      // The passphrase fallback reads this back; without it, every later
      // write on this device would have no credential to unlock.
      localStorage.setItem('kin_credentialId', pk.credentialId)
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

  /* ── welcome ───────────────────────────────────────────────────────────── */
  if (step === 'welcome') {
    return (
      <div className="screen screen--welcome">
        <div className="screen__pad">
          <div className="kicker">Kin</div>

          {/* Show the thing rather than describe it: two cards lifted out of
              the real app, tilted the way they'd sit in a hand. */}
          <div style={{ marginTop: 26, position: 'relative', height: 212 }} aria-hidden="true">
            <Blob size={62} right={8} top={-20} rotate={-18} opacity={0.42} />
            <Blob size={40} right={74} top={56} rotate={14} opacity={0.34} />
            <Blob size={48} left={-6} bottom={-10} rotate={-26} opacity={0.34} />

            <div className="balance" style={{ position: 'absolute', left: 0, top: 0, right: 30, padding: 20 }}>
              <div className="kicker" style={{ fontSize: 10 }}>Balance</div>
              <div className="figure" style={{ marginTop: 10 }}>
                <span className="figure__big" style={{ fontSize: 42, lineHeight: 1 }}>499</span>
                <span className="figure__cents" style={{ fontSize: 20, color: 'var(--muted)' }}>.99</span>
              </div>
              <div className="note" style={{ marginTop: 8, fontSize: 11 }}>USDT · earning in Aave</div>
            </div>

            <div
              style={{
                position: 'absolute', left: 52, top: 130, right: 0, padding: '14px 16px',
                borderRadius: 'var(--r2)', background: 'var(--pale)',
                display: 'flex', alignItems: 'center', gap: 12,
              }}
            >
              <span className="avatar avatar--sm" style={{ background: 'var(--deep)', color: 'var(--pale)' }}>M</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>Maya</div>
                <div style={{ fontSize: 11, color: 'var(--on-pale)' }}>13.60 USDT left this week</div>
              </div>
            </div>
          </div>

          <div className="spacer" />

          <h1 className="display">Pocket money that can&rsquo;t go wrong.</h1>
          <p className="lede mt3" style={{ marginBottom: 22 }}>
            One balance for the house. You set what each person can spend, and the
            limits hold whether or not anyone is watching.
          </p>

          <button className="btn tap" onClick={() => go('names')}>Get started</button>
          <button className="btn btn--quiet tap mt2" onClick={() => go('signin')}>Sign in</button>
          {err && <p className="warn mt3" role="alert">{err}</p>}
        </div>
      </div>
    )
  }

  /* ── the rest ──────────────────────────────────────────────────────────── */
  return (
    <div className="screen screen--step">
      <div className="screen__pad">
        {step === 'names' && (
          <>
            <div className="kicker">Step 1 of 2</div>
            <h2 className="title mt3" style={{ marginBottom: 24 }}>Who&rsquo;s this for?</h2>

            <label className="field">
              <span>What the house is called</span>
              <input
                className="input" type="text" placeholder="Vance" value={famName} autoFocus
                onChange={(e) => setFamName(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Your first name</span>
              <input
                className="input" type="text" placeholder="Priya" value={parentName}
                onChange={(e) => setParentName(e.target.value)}
              />
            </label>

            <div className="spacer" />
            <button
              className="btn tap"
              onClick={nameFamily}
              disabled={busy || !famName.trim() || !parentName.trim()}
            >
              {busy ? <><span className="spin" />One moment…</> : 'Continue'}
            </button>
            <button className="btn btn--quiet tap mt2" onClick={() => go('welcome')}>Back</button>
          </>
        )}

        {step === 'secure' && (
          <>
            <div className="kicker">Step 2 of 2</div>
            <h2 className="title mt3" style={{ marginBottom: 10 }}>Lock it to you, {parentName || 'you'}.</h2>
            <p className="lede">
              Your face is the key. Nothing is stored on this phone, and every
              payment asks again.
            </p>

            {!usePassphrase ? (
              <>
                <div className="markbox markbox--accent mt5">
                  <Icon name="face" size={46} />
                </div>
                <div className="spacer" />
                {!webauthnAvailable() && (
                  <p className="hint" style={{ marginBottom: 10 }}>
                    This browser has no Face ID — use a passphrase.
                  </p>
                )}
                <button className="btn tap" onClick={createWithFaceId} disabled={busy}>
                  {busy ? <><span className="spin" />Setting up…</> : 'Use Face ID'}
                </button>
                <button className="btn btn--quiet tap mt2" onClick={() => setUsePassphrase(true)}>
                  Use a passphrase instead
                </button>
              </>
            ) : (
              <>
                <label className="field mt5">
                  <span>Choose a passphrase</span>
                  <input
                    className="input" type="password" placeholder="At least 8 characters"
                    value={passphrase} autoFocus onChange={(e) => setPassphrase(e.target.value)}
                  />
                </label>
                <div className="spacer" />
                <button className="btn tap" onClick={createWithPassphrase} disabled={busy || passphrase.length < 8}>
                  {busy ? <><span className="spin" />Setting up…</> : 'Create my account'}
                </button>
                {webauthnAvailable() && (
                  <button className="btn btn--quiet tap mt2" onClick={() => setUsePassphrase(false)}>
                    Use Face ID instead
                  </button>
                )}
              </>
            )}
          </>
        )}

        {step === 'signin' && (
          <>
            <div className="kicker">Kin</div>
            <div className="spacer" />
            <h2 className="title" style={{ marginBottom: 10 }}>Welcome back.</h2>
            <p className="lede">Same face, same account.</p>
            <div className="spacer" />

            {!usePassphrase ? (
              <>
                <button className="btn tap" onClick={signInFaceId} disabled={busy}>
                  {busy ? <><span className="spin" />Opening…</> : 'Sign in with Face ID'}
                </button>
                <button className="btn btn--quiet tap mt2" onClick={() => setUsePassphrase(true)}>
                  Use my passphrase
                </button>
              </>
            ) : (
              <>
                <label className="field" style={{ marginBottom: 18 }}>
                  <span>Your passphrase</span>
                  <input
                    className="input" type="password" value={passphrase} autoFocus
                    onChange={(e) => setPassphrase(e.target.value)}
                  />
                </label>
                <button className="btn tap" onClick={signInPassphrase} disabled={busy || passphrase.length < 8}>
                  {busy ? <><span className="spin" />Opening…</> : 'Sign in'}
                </button>
                <button className="btn btn--quiet tap mt2" onClick={() => setUsePassphrase(false)}>
                  Use Face ID
                </button>
              </>
            )}
            <button className="link tap mt2" style={{ alignSelf: 'center' }} onClick={() => go('welcome')}>Back</button>
          </>
        )}

        {err && <p className="warn mt3" role="alert">{err}</p>}
      </div>
    </div>
  )
}
