import { useState } from 'react'
import { api } from '../api'
import { knownCredentialId, rememberCredentialId } from '../auth'
import { createPasskey, unlockPasskey } from '../webauthn'
import { KeyChoice } from '../components/KeyChoice'
import { Icon, Mark } from '../components/ui'
import family from '../assets/family.svg'

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
  // Only asked for when this browser has no credential of its own to offer.
  const [address, setAddress] = useState('')
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
    rememberCredentialId(r.credentialId)
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
      // Without this the passphrase fallback has no credential to unlock.
      rememberCredentialId(pk.credentialId)
      onReady()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not sign in.')
    } finally { setBusy(false) }
  }

  /**
   * Sign in with a passphrase.
   *
   * A passkey carries its own identity; a passphrase does not. On a browser
   * that has signed in before we still have the credential it used, so nothing
   * needs typing. On a fresh one the account is named by its address, which
   * the app shows on the home screen and the chain knows anyway. Without that
   * second path, clearing a browser locked the account away for good.
   */
  const signInPassphrase = async () => {
    setErr(''); setBusy(true)
    try {
      const credentialId = knownCredentialId()
      await api.post('/api/session', credentialId
        ? { credentialId, passphrase }
        : { address: address.trim(), passphrase })
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
          <div className="brand">
            <Mark size={27} />
            <span className="brand__name">Familia</span>
          </div>

          {/* The household at the middle, the money going round it. Three
              orbits at different radii and periods, so the coins never settle
              into a pattern. The family is the thing that stays still. */}
          <div className="orbit" aria-hidden="true">
            <div className="orbit__glow" />
            <img className="orbit__family" src={family} alt="" />
            {[1, 2, 3].map((n) => (
              <div key={n} className={`orbit__arm orbit__arm--${n}`}>
                <span className={`blob orbit__coin orbit__coin--${n}`} />
              </div>
            ))}
          </div>

          <div className="spacer" />

          <h1 className="display">One wallet the whole house runs on.</h1>
          <p className="lede" style={{ marginTop: 14, marginBottom: 22, lineHeight: 1.55 }}>
            Pocket money, the shopping and the bills, out of one balance that
            earns while it sits. Every limit is held by a contract, not by us.
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

            <div className="markbox markbox--accent mt5">
              <Icon name="face" size={46} />
            </div>
            <div className="spacer" />
            <KeyChoice
              mode={usePassphrase ? 'passphrase' : 'faceId'}
              onMode={(m) => setUsePassphrase(m === 'passphrase')}
              passphrase={passphrase}
              onPassphrase={setPassphrase}
              busy={busy}
              faceId="Use Face ID"
              confirm="Create my account"
              working="Setting up…"
              onFaceId={createWithFaceId}
              onSubmit={createWithPassphrase}
            />
          </>
        )}

        {step === 'signin' && (
          <>
            <div className="kicker">Familia</div>
            <div className="spacer" />
            <h2 className="title" style={{ marginBottom: 10 }}>Welcome back.</h2>
            <p className="lede">
              {knownCredentialId()
                ? 'Same face, same account.'
                : 'This browser is new here, so say which account is yours.'}
            </p>
            <div className="spacer" />

            {/* Nothing to identify the account with, so ask. A passkey supplies
                its own credential and skips this entirely. */}
            {!knownCredentialId() && usePassphrase && (
              <label className="field">
                <span>Your account address</span>
                <input
                  className="input num" value={address} placeholder="0x…" spellCheck={false}
                  autoCapitalize="off" autoComplete="username"
                  onChange={(e) => setAddress(e.target.value)}
                />
              </label>
            )}

            <KeyChoice
              mode={usePassphrase ? 'passphrase' : 'faceId'}
              onMode={(m) => setUsePassphrase(m === 'passphrase')}
              passphrase={passphrase}
              onPassphrase={setPassphrase}
              busy={busy}
              faceId="Sign in with Face ID"
              confirm="Sign in"
              working="Opening…"
              onFaceId={signInFaceId}
              onSubmit={signInPassphrase}
              blocked={!knownCredentialId() && !/^0x[0-9a-fA-F]{40}$/.test(address.trim())}
            />
            <button className="link tap mt2" style={{ alignSelf: 'center' }} onClick={() => go('welcome')}>Back</button>
          </>
        )}

        {err && <p className="warn mt3" role="alert">{err}</p>}
      </div>
    </div>
  )
}
