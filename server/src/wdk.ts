// WDK account factory and session cache. One WDK instance per unlocked
// session, disposed on expiry so keys never outlive their session.
import WDK from '@tetherto/wdk'
import WalletManagerEvm7702Gasless from '@tetherto/wdk-wallet-evm-7702-gasless'
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

// ------------------------------------------------------------------ sessions
export type Session = {
  id: string
  role: 'parent' | 'member'
  memberId?: string
  address: string
  /** Sponsored. Members only ever use this; a parent uses it to bootstrap. */
  account: GaslessAccount
  /** Parents only: the same key paying its own fees in USD₮. */
  usdtPayer?: GaslessAccount
  dispose: () => void
  expiresAt: number
}

const SESSION_TTL_MS = 45 * 60 * 1000
const sessions = new Map<string, Session>()

export async function createSession(role: 'parent' | 'member', memberId: string | undefined, mnemonic: string): Promise<Session> {
  const { wdk, getAccount } = createWdk(mnemonic, { memberGuard: role === 'member' })
  const account = await getAccount()

  // Members are sponsored, always — a child should never need a token balance
  // to spend their allowance. Only the parent pays their own way.
  let payer: { wdk: WDK; account: GaslessAccount } | undefined
  if (role === 'parent' && USDT_PAYMASTER) {
    const p = createUsdtPayingWdk(mnemonic)
    payer = { wdk: p.wdk, account: await p.getAccount() }
  }

  const session: Session = {
    id: randomBytes(24).toString('hex'),
    role,
    memberId,
    address: await account.getAddress(),
    account,
    usdtPayer: payer?.account,
    dispose: () => {
      wdk.dispose()
      payer?.wdk.dispose()
    },
    expiresAt: Date.now() + SESSION_TTL_MS,
  }
  sessions.set(session.id, session)
  return session
}

export function getSession(id: string | undefined): Session | undefined {
  if (!id) return undefined
  const s = sessions.get(id)
  if (!s) return undefined
  if (Date.now() > s.expiresAt) {
    destroySession(id)
    return undefined
  }
  s.expiresAt = Date.now() + SESSION_TTL_MS // sliding
  return s
}

export function destroySession(id: string) {
  const s = sessions.get(id)
  if (s) {
    s.dispose()
    sessions.delete(id)
  }
}

setInterval(() => {
  for (const [id, s] of sessions) if (Date.now() > s.expiresAt) destroySession(id)
}, 60_000).unref()
