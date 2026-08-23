// WDK account factory and session cache. One WDK instance per unlocked
// session, disposed on expiry so keys never outlive their session.
import WDK from '@tetherto/wdk'
import WalletManagerEvm7702Gasless, { WalletAccountReadOnlyEvm7702Gasless } from '@tetherto/wdk-wallet-evm-7702-gasless'
import { randomBytes } from 'node:crypto'
import {
  AAVE, BUNDLER_URL, DELEGATION_ADDRESS, MANAGER, PAYMASTER_SERVICE_URL, POLICY_ID, RPC_URL, USDT_PAYMASTER,
} from './chain.js'

// The concrete account type is resolved at runtime; keep a structural type.
export type GaslessAccount = {
  getAddress(): Promise<string>
  sendTransaction(tx: unknown, cfg?: unknown): Promise<{ hash: string }>
  quoteSendTransaction(tx: unknown, cfg?: unknown): Promise<{ fee: bigint }>
  getUserOperationReceipt(hash: string): Promise<{
    success: boolean
    // abstractionkit returns the bundling tx's logs as a JSON string
    logs: string | Array<{ address: string; topics: string[]; data: string }>
    receipt?: { transactionHash?: string; logs?: string | Array<{ address: string; topics: string[]; data: string }> }
  } | null>
  dispose(): void
}

export function createWdk(mnemonic: string, opts: { memberGuard?: boolean } = {}): { wdk: WDK; getAccount: () => Promise<GaslessAccount> } {
  // Cast: the beta .d.ts types registerWallet against the base WalletManager,
  // whose config is optional — structurally fine at runtime.
  const wdk = new WDK(mnemonic).registerWallet('ethereum', WalletManagerEvm7702Gasless as unknown as Parameters<WDK['registerWallet']>[1], {
    provider: RPC_URL,
    bundlerUrl: BUNDLER_URL,
    delegationAddress: DELEGATION_ADDRESS,
    isSponsored: true,
    ...(POLICY_ID ? { sponsorshipPolicyId: POLICY_ID } : {}),
  } as unknown as Parameters<WDK['registerWallet']>[2])

  if (opts.memberGuard) {
    // WDK's local policy engine as defense in depth: a member's session
    // account may only ever talk to the ScopedSpendManager. This is a UX/
    // safety affordance on the Node worker — the contract is the enforcement.
    wdk.registerPolicy({
      id: 'member-manager-only',
      name: 'Members transact only with the spend manager',
      scope: 'project',
      wallet: 'ethereum',
      rules: [
        {
          name: 'deny-non-manager-targets',
          reason: 'Member accounts may only call the ScopedSpendManager.',
          operation: ['sendTransaction', 'signTransaction', 'transfer', 'approve'],
          action: 'DENY',
          conditions: [(ctx: { args: readonly unknown[] }) => !targetsManagerOnly(ctx.args[0])],
        },
        {
          // A governed account with no matching rule is denied by default, so
          // the permitted path needs to be stated explicitly.
          name: 'allow-manager-targets',
          operation: ['sendTransaction', 'signTransaction', 'transfer', 'approve'],
          action: 'ALLOW',
          conditions: [(ctx: { args: readonly unknown[] }) => targetsManagerOnly(ctx.args[0])],
        },
      ],
    } as Parameters<WDK['registerPolicy']>[0])
  }

  return { wdk, getAccount: () => wdk.getAccount('ethereum', 0) as Promise<unknown> as Promise<GaslessAccount> }
}

/**
 * The same key, viewed through our own USD₮ paymaster instead of sponsorship.
 *
 * This is a separate WDK registration rather than a per-call override because
 * `paymasterUrl` is wallet-level: sponsored operations must reach Pimlico,
 * while USD₮-priced ones must reach our ERC-7677 service. `paymasterAddress`
 * is pinned so WDK throws if the service ever names a different contract.
 */
export function createUsdtPayingWdk(mnemonic: string): { wdk: WDK; getAccount: () => Promise<GaslessAccount> } {
  const wdk = new WDK(mnemonic).registerWallet('ethereum', WalletManagerEvm7702Gasless as unknown as Parameters<WDK['registerWallet']>[1], {
    provider: RPC_URL,
    bundlerUrl: BUNDLER_URL,
    delegationAddress: DELEGATION_ADDRESS,
    isSponsored: false,
    paymasterUrl: PAYMASTER_SERVICE_URL,
    paymasterAddress: USDT_PAYMASTER,
    paymasterToken: { address: AAVE.ASSET },
  } as unknown as Parameters<WDK['registerWallet']>[2])
  return { wdk, getAccount: () => wdk.getAccount('ethereum', 0) as Promise<unknown> as Promise<GaslessAccount> }
}

/**
 * Price an operation in USD₮ without signing it — and therefore without a key.
 *
 * Quoting is a read, so it must not require the person to authorise anything;
 * they should see the fee *before* deciding to. WDK's read-only account builds
 * the same user operation and asks the paymaster what it costs.
 */
export async function quoteUnsigned(address: string, txs: unknown): Promise<bigint> {
  const readOnly = new WalletAccountReadOnlyEvm7702Gasless(address, {
    provider: RPC_URL,
    bundlerUrl: BUNDLER_URL,
    delegationAddress: DELEGATION_ADDRESS,
    isSponsored: false,
    paymasterUrl: PAYMASTER_SERVICE_URL,
    paymasterAddress: USDT_PAYMASTER,
    paymasterToken: { address: AAVE.ASSET },
  } as never)
  const { fee } = await (readOnly as unknown as {
    quoteSendTransaction(tx: unknown): Promise<{ fee: bigint }>
  }).quoteSendTransaction(txs)
  return fee
}

/** Derive the account address for a mnemonic without keeping anything. */
export async function addressForMnemonic(mnemonic: string): Promise<string> {
  const { wdk, getAccount } = createWdk(mnemonic)
  try {
    return await (await getAccount()).getAddress()
  } finally {
    wdk.dispose()
  }
}

/**
 * Pimlico's eth_getUserOperationByHash lags (returns null for included ops),
 * which stalls WDK's waitForTransaction — it polls byHash first. Poll the
 * receipt endpoint instead: prompt and authoritative. (Field-verified: ops
 * "stuck" for 10 minutes under waitForTransaction confirm in ~17s this way.)
 */
export async function waitForUserOp(
  account: GaslessAccount,
  hash: string,
  { timeout = 240_000, interval = 4_000 } = {},
) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const receipt = await account.getUserOperationReceipt(hash).catch(() => null)
    if (receipt) {
      return {
        success: receipt.success,
        txHash: receipt.receipt?.transactionHash,
        logs: normalizeLogs(receipt.logs).concat(normalizeLogs(receipt.receipt?.logs)),
      }
    }
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error(`userOp ${hash} not included within ${timeout / 1000}s`)
}

function targetsManagerOnly(arg: unknown): boolean {
  const txs = Array.isArray(arg) ? arg : [arg]
  return txs.length > 0 && txs.every(
    (t) => typeof (t as { to?: string })?.to === 'string' &&
      (t as { to: string }).to.toLowerCase() === MANAGER.toLowerCase(),
  )
}

type Log = { address: string; topics: string[]; data: string }

function normalizeLogs(logs: unknown): Log[] {
  if (!logs) return []
  const parsed = typeof logs === 'string' ? JSON.parse(logs) : logs
  return Array.isArray(parsed) ? parsed.filter((l): l is Log => Boolean(l && typeof l.address === 'string')) : []
}

// ------------------------------------------------- identity and authorisation
//
// A session says who you are. It holds no key, so a stolen cookie can read
// this household's state and nothing else — it cannot move money.
//
// Every write instead carries a fresh key source: the PRF output a passkey
// re-derives at that moment, or a passphrase. The seed is reconstructed for
// the length of one operation and disposed in a finally block, so the window
// in which this process could sign anything is a single request rather than a
// 45-minute session.

/**
 * Run one operation with a live signing account, then destroy it.
 *
 * The account exists only inside `fn`. Whatever happens — success, revert,
 * thrown error — the WDK instance is disposed on the way out, which is what
 * keeps the key's lifetime equal to the request's.
 */
export async function withAccount<T>(
  mnemonic: string,
  opts: { memberGuard?: boolean; payFeesInUsdt?: boolean },
  fn: (account: GaslessAccount) => Promise<T>,
): Promise<T> {
  const made = opts.payFeesInUsdt ? createUsdtPayingWdk(mnemonic) : createWdk(mnemonic, { memberGuard: opts.memberGuard })
  try {
    return await fn(await made.getAccount())
  } finally {
    made.wdk.dispose()
  }
}
