import { useState } from 'react'
import { approvalProblem, approve, knownCredentialId, NeedsPassphrase, type Approval } from './auth'
import type { Pending } from './components/Confirm'

/**
 * Getting a signature, on either side of the app.
 *
 * Both screens need the same three beats: put up a confirmation, ask the
 * authenticator, and fall back to a passphrase when the device has no PRF.
 * They had a copy each — the state pair, the catch block, the handler and the
 * sheet were byte-identical — which is how the fallback ended up fixed in one
 * of them and broken in the other.
 */
export function useApproval() {
  const [pending, setPending] = useState<Pending | null>(null)
  const [passphraseFor, setPassphraseFor] = useState<((a: Approval) => void) | null>(null)
  const [passphrase, setPassphrase] = useState('')

  /**
   * Put up the confirmation for one action.
   *
   * `run` is handed the key material once the person has approved. It is not
   * called otherwise, and nothing is cached between calls.
   */
  const ask = (spec: Omit<Pending, 'run'>, run: (auth: Approval) => void) => {
    setPending({
      ...spec,
      run: () => {
        approve().then(run).catch((e) => {
          if (e instanceof NeedsPassphrase) {
            // Hand off to the passphrase sheet and drop this one: they stack,
            // and the confirmation sits above it.
            setPending(null)
            setPassphraseFor(() => run)
            return
          }
          // A cancelled or failed prompt: say so in the sheet rather than
          // making it vanish with nothing to read.
          setPending((p) => p && { ...p, blocked: approvalProblem(e) })
        })
      },
    })
  }

  const submitPassphrase = () => {
    const credentialId = knownCredentialId()
    const run = passphraseFor
    const value = passphrase
    setPassphraseFor(null)
    setPassphrase('')
    if (credentialId && run) run({ credentialId, passphrase: value })
  }

  return {
    pending,
    setPending,
    ask,
    /** Everything the passphrase sheet needs, and nothing the caller has to
     *  wire up itself. */
    passphrase: {
      open: Boolean(passphraseFor),
      value: passphrase,
      onChange: setPassphrase,
      onClose: () => setPassphraseFor(null),
      onSubmit: submitPassphrase,
    },
  }
}

export type PassphrasePrompt = ReturnType<typeof useApproval>['passphrase']
