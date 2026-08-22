// WDK account factory and session cache. One WDK instance per unlocked
// session, disposed on expiry so keys never outlive their session.
import WDK from '@tetherto/wdk'
import WalletManagerEvm7702Gasless from '@tetherto/wdk-wallet-evm-7702-gasless'
import { randomBytes } from 'node:crypto'
import { BUNDLER_URL, DELEGATION_ADDRESS, POLICY_ID, SEPOLIA_RPC_URL } from './chain.js'

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

export function createWdk(mnemonic: string): { wdk: WDK; getAccount: () => Promise<GaslessAccount> } {
  // Cast: the beta .d.ts types registerWallet against the base WalletManager,
  // whose config is optional — structurally fine at runtime.
  const wdk = new WDK(mnemonic).registerWallet('ethereum', WalletManagerEvm7702Gasless as Parameters<WDK['registerWallet']>[1], {
    provider: SEPOLIA_RPC_URL,
    bundlerUrl: BUNDLER_URL,
    delegationAddress: DELEGATION_ADDRESS,
    isSponsored: true,
    ...(POLICY_ID ? { sponsorshipPolicyId: POLICY_ID } : {}),
  })
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
  account: GaslessAccount
  dispose: () => void
  expiresAt: number
}

const SESSION_TTL_MS = 45 * 60 * 1000
const sessions = new Map<string, Session>()

export async function createSession(role: 'parent' | 'member', memberId: string | undefined, mnemonic: string): Promise<Session> {
  const { wdk, getAccount } = createWdk(mnemonic)
  const account = await getAccount()
  const session: Session = {
    id: randomBytes(24).toString('hex'),
    role,
    memberId,
    address: await account.getAddress(),
    account,
    dispose: () => wdk.dispose(),
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
