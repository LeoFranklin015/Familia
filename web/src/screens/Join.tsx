import { useEffect, useState } from 'react'
import { api } from '../api'
import { rememberCredentialId } from '../auth'
import { createPasskey } from '../webauthn'
import { KeyChoice } from '../components/KeyChoice'
import { Blob, Icon, Skeleton } from '../components/ui'

type Invite = { familyName: string; inviteeName: string; isParent: boolean }

/**
 * What an invited person sees first — a stranger's whole impression of the
 * product, so it says nothing about wallets, funding or keys. From their side
 * this is "tap and you're in".
 *
 * The link carries a one-time token and no key material. Their account exists
 * the moment they tap, holding nothing, and can be given limits before it has
 * ever transacted.
 */
export default function Join({ token, onJoined }: { token: string; onJoined: () => void }) {
  const [invite, setInvite] = useState<Invite | null>(null)
  const [dead, setDead] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [usePassphrase, setUsePassphrase] = useState(false)
  const [passphrase, setPassphrase] = useState('')

  useEffect(() => {
    api.get<Invite>(`/api/join/${token}`).then(setInvite).catch(() => setDead(true))
  }, [token])

  const finish = async (body: Record<string, string>) => {
    const r = await api.post<{ credentialId: string }>(`/api/join/${token}`, body)
    rememberCredentialId(r.credentialId)
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

  /* A used or unknown link. No action offered, because there isn't one — and
     it says plainly that nothing was created, which is the thing a person
     actually worries about here. */
  if (dead) {
    return (
      <div className="screen screen--step">
        <div className="screen__pad">
          <div className="kicker">Kin</div>
          <div className="spacer" />
          <div className="markbox markbox--round" style={{ marginBottom: 24 }}>
            <Icon name="minus" size={26} />
          </div>
          <h1 className="display display--sm">This link&rsquo;s been used.</h1>
          <p className="lede mt2">
            Invites work once. Ask at home for a fresh one and this&rsquo;ll take a second.
          </p>
          <div className="spacer" />
          <div className="kicker kicker--faint">No account was made</div>
        </div>
      </div>
    )
  }

  if (!invite) {
    return (
      <div className="screen screen--welcome">
        <div className="screen__pad" aria-busy="true">
          <div className="kicker">Kin</div>
          <div className="spacer" />
          <Skeleton h={58} w="58px" r={999} />
          <div className="mt5"><Skeleton h={34} w="70%" /></div>
          <Skeleton h={16} w="90%" mt={14} />
          <div className="spacer" />
          <Skeleton h={54} r={999} />
          <span className="sr-only">Opening your invite</span>
        </div>
      </div>
    )
  }

  return (
    <div className="screen screen--welcome">
      <div className="screen__pad">
        <div className="kicker">Kin</div>
        <Blob size={70} right={6} top={112} rotate={-20} opacity={0.38} />
        <Blob size={46} left={-16} top={196} rotate={16} opacity={0.3} />
        <div className="spacer" />

        <span className="avatar avatar--lg" style={{ marginBottom: 24 }}>
          {invite.inviteeName[0]?.toUpperCase()}
        </span>
        <h1 className="display display--sm" style={{ marginBottom: 10 }}>Hi {invite.inviteeName}.</h1>
        <p className="lede lede--bright" style={{ marginBottom: 6 }}>
          {invite.isParent
            ? <>Finish setting up <b>{invite.familyName}</b>.</>
            : <><b>{invite.familyName}</b> added you. Nothing to set up but your face.</>}
        </p>
        <p className="hint">
          Your face makes the account. It takes one tap and there&rsquo;s nothing to remember.
        </p>

        <div className="spacer" />

        <KeyChoice
          mode={usePassphrase ? 'passphrase' : 'faceId'}
          onMode={(m) => setUsePassphrase(m === 'passphrase')}
          passphrase={passphrase}
          onPassphrase={setPassphrase}
          busy={busy}
          faceId="Use Face ID"
          confirm="I'm ready"
          working="Setting you up…"
          onFaceId={withFaceId}
          onSubmit={withPassphrase}
        />

        {err && <p className="warn mt3" role="alert">{err}</p>}
      </div>
    </div>
  )
}
