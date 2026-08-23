import { webauthnAvailable } from '../webauthn'

/**
 * Face ID, or a passphrase.
 *
 * The same shape appears three times — twice in onboarding, once on the
 * invite — and it had been written out three times: the availability warning,
 * the primary button, the quiet alternative, and the password field with the
 * way back. Only the words differ.
 *
 * Both paths reach the same vault. The passphrase derives the same 32 bytes
 * the passkey's PRF would have, so this is a choice of key source rather than
 * a lesser mode.
 */
export function KeyChoice({
  mode, onMode, passphrase, onPassphrase, busy, faceId, confirm, working, onFaceId, onSubmit,
  blocked,
}: {
  mode: 'faceId' | 'passphrase'
  onMode: (m: 'faceId' | 'passphrase') => void
  passphrase: string
  onPassphrase: (v: string) => void
  busy: boolean
  /** Label for the Face ID button. */
  faceId: string
  /** Label for the button that submits a passphrase. */
  confirm: string
  /** What both say while the work is happening. */
  working: string
  onFaceId: () => void
  onSubmit: () => void
  /** Something else the caller still needs before this can be submitted. */
  blocked?: boolean
}) {
  if (mode === 'faceId') {
    return (
      <>
        {!webauthnAvailable() && (
          <p className="hint" style={{ marginBottom: 10 }}>
            This browser has no Face ID. Use a passphrase instead.
          </p>
        )}
        <button className="btn tap" onClick={onFaceId} disabled={busy}>
          {busy ? <><span className="spin" />{working}</> : faceId}
        </button>
        <button className="link link--muted tap alt" onClick={() => onMode('passphrase')}>
          Use a passphrase instead
        </button>
      </>
    )
  }

  return (
    <>
      <label className="field" style={{ marginBottom: 18 }}>
        <span>Your passphrase</span>
        <input
          className="input"
          type="password"
          placeholder="At least 8 characters"
          value={passphrase}
          autoFocus
          onChange={(e) => onPassphrase(e.target.value)}
        />
      </label>
      <button className="btn tap" onClick={onSubmit} disabled={busy || blocked || passphrase.length < 8}>
        {busy ? <><span className="spin" />{working}</> : confirm}
      </button>
      {webauthnAvailable() && (
        <button className="link link--muted tap alt" onClick={() => onMode('faceId')}>
          Use Face ID instead
        </button>
      )}
    </>
  )
}
