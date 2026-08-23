import { Sheet } from './Sheet'
import type { PassphrasePrompt } from '../useApproval'

/**
 * The way in for a device with no Face ID.
 *
 * Same vault, different key: the passphrase derives the same 32 bytes the
 * passkey's PRF would have. Asked for once per action, never remembered.
 */
export function PassphraseSheet({ prompt }: { prompt: PassphrasePrompt }) {
  const ready = prompt.value.length >= 8
  return (
    <Sheet open={prompt.open} title="Confirm it's you" onClose={prompt.onClose}>
      <p className="hint">This device can&rsquo;t use Face ID, so your passphrase approves it.</p>
      <label className="field mt3">
        <span>Passphrase</span>
        <input
          className="input"
          type="password"
          value={prompt.value}
          autoFocus
          enterKeyHint="go"
          onChange={(e) => prompt.onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && ready) prompt.onSubmit() }}
        />
      </label>
      <button className="btn tap mt4" disabled={!ready} onClick={prompt.onSubmit}>
        Approve
      </button>
    </Sheet>
  )
}
