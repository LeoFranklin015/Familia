// Funding the parent's account, once, as part of onboarding.
//
// This is where the faucet is used. It has a per-address mint timelock, so
// doing it here — rather than inside a deposit — means the household's first
// "add to the pot" isn't silently spending a once-a-day resource, and every
// later deposit works from the balance already held.
//
// It runs in the background: signing up stays two taps, and the Pot tab shows
// progress. Failure is recorded rather than thrown, because a parent whose
// funding didn't land should see why, not a broken screen.
import { buildOnboardingBatch } from './chain.js'
import { waitForUserOp, type Session } from './wdk.js'

export type BootstrapState =
  | { status: 'running' }
  | { status: 'done'; txHash?: string }
  | { status: 'failed'; reason: string }
  | { status: 'idle' }

const states = new Map<string, BootstrapState>()

export function bootstrapStatus(address: string): BootstrapState {
  return states.get(address.toLowerCase()) ?? { status: 'idle' }
}

export function bootstrapParent(session: Session): void {
  const key = session.address.toLowerCase()
  if (states.get(key)?.status === 'running') return
  states.set(key, { status: 'running' })

  void (async () => {
    try {
      const txs = await buildOnboardingBatch(session.address)
      if (txs.length === 0) {
        states.set(key, { status: 'done' })
        return
      }
      // Sponsored: the account cannot pay a USD₮ fee until this very
      // operation has given it USD₮ to pay with.
      const { hash } = await session.account.sendTransaction(txs)
      const result = await waitForUserOp(session.account, hash)
      states.set(key, result.success
        ? { status: 'done', txHash: result.txHash }
        : { status: 'failed', reason: 'The funding transaction reverted.' })
    } catch (e) {
      states.set(key, { status: 'failed', reason: e instanceof Error ? e.message : 'Funding failed.' })
    }
  })()
}
