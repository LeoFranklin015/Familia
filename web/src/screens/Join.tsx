import { useEffect, useState } from 'react'
import { api } from '../api'
import { createPasskey, webauthnAvailable } from '../webauthn'

type Invite = { familyName: string; inviteeName: string; isParent: boolean }

/**
 * What an invited person sees. Same rule as onboarding: one primary action,
 * the alternative is a quiet link. No mention of wallets, funding or keys —
 * from their side this is just "tap to get set up".
 */
export default function Join({ token, onJoined }: { token: string; onJoined: () => void }) {
  const [invite, setInvite] = useState<Invite | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [usePassphrase, setUsePassphrase] = useState(false)
  const [passphrase, setPassphrase] = useState('')

  useEffect(() => {
    api.get<Invite>(`/api/join/${token}`).then(setInvite).catch((e) => setErr(e.message))
  }, [token])

  const finish = async (body: Record<string, string>) => {
    const r = await api.post<{ credentialId: string }>(`/api/join/${token}`, body)
    localStorage.setItem('kin_credentialId', r.credentialId)
    onJoined()
  }

  const withFaceId = async () => {
    setErr(''); setBusy(true)
    try {
      const pk = await createPasskey(invite!.inviteeName)
      if (!pk) { setUsePassphrase(true); return }
      await finish({ credentialId: pk.credentialId, prfKeyHex: pk.prfKeyHex })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong.')
    } finally { setBusy(false) }
  }

  const withPassphrase = async () => {
    setErr(''); setBusy(true)
    try { await finish({ passphrase }) }
    catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong.') }
    finally { setBusy(false) }
  }

  if (err && !invite) {
    return (
      <div className="app">
        <header className="topbar"><span className="brand">kin<i>.</i></span></header>
        <h1>This link's no good.</h1>
        <p className="lede">It may have been used already. Ask for a fresh one.</p>
      </div>
    )
  }
  if (!invite) return <div className="app" aria-busy="true"><span className="sr-only">Loading</span></div>

  return (
    <div className="app">
      <header className="topbar"><span className="brand">kin<i>.</i></span></header>
      <h1>Hi {invite.inviteeName}.</h1>
      <p className="lede">
        {invite.isParent
          ? <>Finish setting up <b>{invite.familyName}</b>.</>
          : <><b>{invite.familyName}</b> added you. One tap and you can start paying —
             nothing to install, nothing to top up.</>}
      </p>

      {!usePassphrase ? (
        <>
          <button className="btn btn--primary btn--block" onClick={withFaceId} disabled={busy}>
            {busy ? <><span className="spinner" />Setting you up…</> : 'Use Face ID'}
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
          <input type="password" placeholder="At least 8 characters" value={passphrase} autoFocus
            onChange={(e) => setPassphrase(e.target.value)} />
          <button className="btn btn--primary btn--block" onClick={withPassphrase} disabled={busy || passphrase.length < 8}>
            {busy ? <><span className="spinner" />Setting you up…</> : "I'm ready"}
          </button>
          {webauthnAvailable() && (
            <p className="center-row">
              <button className="link" onClick={() => setUsePassphrase(false)}>Use Face ID instead</button>
            </p>
          )}
        </>
      )}

      {err && <div className="note note--err" role="alert">{err}</div>}
    </div>
  )
}
