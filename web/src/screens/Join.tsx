import { useEffect, useState } from 'react'
import { api } from '../api'
import { createPasskey, webauthnAvailable } from '../webauthn'

type Invite = { familyName: string; inviteeName: string; isParent: boolean }

export default function Join({ token, onJoined }: { token: string; onJoined: () => void }) {
  const [invite, setInvite] = useState<Invite | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [needPassphrase, setNeedPassphrase] = useState(false)
  const [passphrase, setPassphrase] = useState('')

  useEffect(() => {
    api.get<Invite>(`/api/join/${token}`).then(setInvite).catch((e) => setErr(e.message))
  }, [token])

  const finish = async (body: Record<string, string>) => {
    const r = await api.post<{ credentialId: string }>(`/api/join/${token}`, body)
    localStorage.setItem('kin_credentialId', r.credentialId)
    onJoined()
  }

  const joinWithPasskey = async () => {
    setErr(''); setBusy(true)
    try {
      const pk = await createPasskey(invite!.inviteeName)
      if (!pk) {
        // PRF unsupported here — same vault, passphrase-derived key instead.
        setNeedPassphrase(true)
        return
      }
      await finish({ credentialId: pk.credentialId, prfKeyHex: pk.prfKeyHex })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const joinWithPassphrase = async () => {
    setErr(''); setBusy(true)
    try {
      await finish({ passphrase })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  if (err && !invite) {
    return (
      <div>
        <div className="topbar"><span className="brand">kin<span className="dot">.</span></span></div>
        <div className="note err">{err}</div>
      </div>
    )
  }
  if (!invite) return <div className="center" style={{ paddingTop: 80 }}><span className="spinner" /></div>

  return (
    <div>
      <div className="topbar"><span className="brand">kin<span className="dot">.</span></span></div>
      <h1>Hi {invite.inviteeName}.</h1>
      <p className="sub">
        {invite.isParent
          ? <>You're setting up <strong>{invite.familyName}</strong>.</>
          : <>You've been invited to <strong>{invite.familyName}</strong>.</>}
        {' '}One tap creates your account — nothing to install, nothing to fund, no codes to write down.
      </p>

      <div className="card stack">
        {!needPassphrase && webauthnAvailable() && (
          <button className="primary" onClick={joinWithPasskey} disabled={busy}>
            {busy ? <><span className="spinner" />Creating your account…</> : 'Continue with Face ID'}
          </button>
        )}
        {!needPassphrase && (
          <button className="mini" onClick={() => setNeedPassphrase(true)}>Use a passphrase instead</button>
        )}
        {needPassphrase && (
          <>
            <label>Choose a passphrase (at least 8 characters)</label>
            <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
            <button className="primary" onClick={joinWithPassphrase} disabled={busy || passphrase.length < 8}>
              {busy ? <><span className="spinner" />Creating your account…</> : 'Create my account'}
            </button>
          </>
        )}
      </div>
      {err && <div className="note err">{err}</div>}
    </div>
  )
}
