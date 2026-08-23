import { useState } from 'react'
import { api, type Identity } from '../api'
import { forgetAccount, knownAccounts, rememberAccount, type KnownAccount } from '../auth'
import { createPasskey, unlockPasskey } from '../webauthn'
import { KeyChoice } from '../components/KeyChoice'
import { Icon, Mark } from '../components/ui'
import { Check } from './family/rows'
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
  // The accounts this browser knows, and which one is being signed into. Read
  // once: localStorage does not change under us, and reading it in render made
  // every keystroke touch it.
  const [accounts, setAccounts] = useState<KnownAccount[]>(() => knownAccounts())
  const [picked, setPicked] = useState<KnownAccount | null>(() => knownAccounts()[0] ?? null)
  // Only asked for when the account being signed into is not one of those.
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
    const r = await api.post<Identity>(`/api/join/${token}`, body)
    rememberAccount({ ...r, prf: Boolean(body.prfKeyHex) })
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
      // Unscoped on purpose: the authenticator offers whichever passkeys this
      // device holds for the site, which is the right picker to show someone
      // who is signing in rather than approving a payment.
      const pk = await unlockPasskey()
      if (!pk) throw new Error('This device could not use a passkey. Try your passphrase.')
      const r = await api.post<Identity>('/api/session', {
        credentialId: pk.credentialId, prfKeyHex: pk.prfKeyHex,
      })
      // Without this the passphrase fallback has no credential to unlock.
      rememberAccount({ ...r, prf: true })
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
      const r = await api.post<Identity>('/api/session', picked
        ? { credentialId: picked.credentialId, passphrase }
        : { address: address.trim(), passphrase })
      rememberAccount({ ...r, prf: false })
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
              {picked
                ? `Signing in as ${picked.name}${picked.familyName ? `, ${picked.familyName}` : ''}.`
                : accounts.length
                  ? 'Which account is this?'
                  : 'Your face is the key. A passphrase works too.'}
            </p>
            <div className="spacer" />

            {/* The accounts this browser already knows. A household shares a
                phone, so offer the choice rather than assuming whoever went
                last is whoever is here now. */}
            {accounts.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                {accounts.map((a) => (
                  <div key={a.credentialId} className="recipient">
                    <button
                      className="row__pick tap"
                      aria-pressed={picked?.credentialId === a.credentialId}
                      onClick={() => { setErr(''); setPicked(a); setUsePassphrase(!a.prf) }}
                    >
                      <Check on={picked?.credentialId === a.credentialId} />
                      <span className="avatar avatar--sm">{a.name[0]?.toUpperCase() ?? '?'}</span>
                      <span className="row__body">
                        <span className="recipient__name">{a.name}</span>
                        <span className="recipient__addr">
                          {a.familyName ? `${a.familyName} · ` : ''}
                          {a.prf ? 'Face ID' : 'Passphrase'}
                        </span>
                      </span>
                    </button>
                    <button
                      className="link tap link--sm"
                      onClick={() => {
                        forgetAccount(a.credentialId)
                        const left = knownAccounts()
                        setAccounts(left)
                        if (picked?.credentialId === a.credentialId) setPicked(left[0] ?? null)
                      }}
                    >
                      Forget
                    </button>
                  </div>
                ))}

                <button
                  className="link tap mt3"
                  onClick={() => { setErr(''); setPicked(null); setUsePassphrase(true) }}
                >
                  Another account
                </button>
              </div>
            )}

            {/* Only a passphrase needs this. A passkey carries its own
                identity, so on an unknown browser the authenticator offers
                whatever it holds and nothing has to be typed at all. */}
            {!picked && usePassphrase && (
              <label className="field">
                <span>Your account address</span>
                <input
                  className="input num" value={address} placeholder="0x…" spellCheck={false}
                  autoCapitalize="off" autoComplete="username"
                  onChange={(e) => setAddress(e.target.value)}
                />
                <span className="hint" style={{ marginTop: 7 }}>
                  It is on your home screen, under the balance.
                </span>
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
              blocked={!picked && !/^0x[0-9a-fA-F]{40}$/.test(address.trim())}

            />
            <button className="link tap mt2" style={{ alignSelf: 'center' }} onClick={() => go('welcome')}>Back</button>
          </>
        )}

        {err && <p className="warn mt3" role="alert">{err}</p>}
      </div>
    </div>
  )
}
