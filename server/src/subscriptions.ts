// Recurring mandates, and the biller that collects them.
//
// A subscription is the same object as a child's allowance: a scope on
// ScopedSpendManager with a biller as the spender instead of a family member.
// The contract needed no changes at all, which is the point of it having no
// notion of a family in the first place.
//
// The caps are what make this a mandate rather than a standing order the
// merchant controls. `perTxCap` and `periodCap` are both the monthly price and
// the period is a month, so the biller can take the price once per month and
// nothing else. A second attempt inside the same period is refused on-chain.
// The allowlist pins the destination, so the biller cannot redirect the money
// to itself either.
import { ethers } from 'ethers'
import { MANAGER, managerIface, provider } from './chain.js'

/** A month, in seconds. What a subscription period runs over. */
export const MONTH_SECONDS = 30 * 86400

/**
 * How many months a mandate runs for before it lapses on its own.
 *
 * The expiry is exactly this many periods, so a service gets twelve charges
 * and a thirteenth is refused even if nobody remembered to cancel. Set it any
 * longer and the last period would leave a window for one more.
 *
 * An open-ended mandate is the one people cannot get rid of. This one runs out.
 */
export const TERM_MONTHS = 12
export const TERM_SECONDS = TERM_MONTHS * MONTH_SECONDS

export type Service = {
  id: string
  name: string
  /** Monthly price, in whole USD₮. */
  price: string
  /** Where the money lands. Deterministic, and obviously a test address. */
  payTo: string
}

/**
 * What a household can subscribe to.
 *
 * Fixed rather than user-entered, because the demo is about the mandate and
 * not about typing an address. The payout addresses follow the same
 * obviously-fake pattern as the starter address book.
 */
export const SERVICES: readonly Service[] = [
  { id: 'netflix', name: 'Netflix', price: '15.49', payTo: '0x4444000000000000000000000000000000004444' },
  { id: 'spotify', name: 'Spotify', price: '11.99', payTo: '0x5555000000000000000000000000000000005555' },
  { id: 'disney', name: 'Disney+', price: '7.99', payTo: '0x6666000000000000000000000000000000006666' },
  { id: 'youtube', name: 'YouTube Premium', price: '13.99', payTo: '0x7777000000000000000000000000000000007777' },
  { id: 'icloud', name: 'iCloud+', price: '2.99', payTo: '0x8888000000000000000000000000000000008888' },
]

export const serviceById = (id: string): Service | undefined =>
  SERVICES.find((s) => s.id === id)

// ------------------------------------------------------------------ biller
/**
 * The account that collects. One key stands in for every biller here, which is
 * fine because the spender is not what bounds the mandate: the scope's caps and
 * its allowlist are, and those are set by the household.
 *
 * It signs plain transactions and pays its own gas in ETH, which is what a real
 * merchant would do. No family member ever pays for a collection.
 */
let signer: ethers.Wallet | undefined

export function biller(): ethers.Wallet {
  if (!signer) {
    const key = process.env.BILLER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY
    if (!key) throw new Error('No BILLER_PRIVATE_KEY is set, so nothing can collect.')
    signer = new ethers.Wallet(key, provider)
  }
  return signer
}

/** The spender every subscription scope is granted to. */
export const billerAddress = (): string => biller().address

/**
 * Take one month's payment.
 *
 * Every check that matters happens inside `spend`: that this scope is live,
 * that the amount is within both caps, and that the destination is on the
 * allowlist. Anything wrong reverts, and the reason comes back decoded rather
 * than as a hex blob.
 */
export async function collect(
  scopeId: string,
  payTo: string,
  amount: bigint,
): Promise<{ txHash: string }> {
  const tx = await biller().sendTransaction({
    to: MANAGER,
    data: managerIface.encodeFunctionData('spend', [scopeId, payTo, amount]),
  })
  const receipt = await tx.wait()
  if (!receipt || receipt.status !== 1) throw new Error('The collection did not go through.')
  return { txHash: tx.hash }
}
