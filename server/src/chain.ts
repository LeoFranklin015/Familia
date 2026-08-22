// Addresses, interfaces and calldata builders. Token addresses come from the
// canonical Aave address book — never pasted hex.
//
// Base Sepolia. The family money is USD₮ supplied to Aave V3's real pool, so
// the parent holds genuine aUSDT and a member's spend redeems it through Aave
// itself — no vault of ours anywhere in the path.
//
// Why not Ethereum Sepolia: its Aave USDT reserve sits ~2x over its supply cap
// and reverts with error 51 for any amount (so do USDC and DAI). Base
// Sepolia's USDT reserve is uncapped, faucet-mintable and liquid. The trade is
// that Pimlico/Candide only price gas in USD₮ on Ethereum Sepolia, so here
// every operation is fully sponsored instead — which the track allows.
import { ethers } from 'ethers'
import { AaveV3BaseSepolia } from '@bgd-labs/aave-address-book'

// This module reads env at import time, so the env file loads here — ESM
// hoists imports, which makes loading it in index.ts too late.
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url).pathname)
} catch { /* fine in environments that export the vars directly */ }

export const CHAIN_ID = 84532

/** Aave's public testnet faucet on Base Sepolia — the token's owner, and
 *  unpermissioned (`isPermissioned() == false`), so the parent can mint their
 *  own test USD₮ inside their first sponsored operation. */
const FAUCET = '0xD9145b5F45Ad4519c7ACcD6E0A4A82e83bB8A6Dc'

export const AAVE = {
  FAUCET,
  POOL: AaveV3BaseSepolia.POOL as string,
  ASSET: AaveV3BaseSepolia.ASSETS.USDT.UNDERLYING as string,
  // Aave's own aUSDT: what the parent holds, and what the manager pulls and
  // redeems on a spend. Interest-bearing and rebasing, so balances are always
  // read inside the transaction and never cached.
  A_ASSET: AaveV3BaseSepolia.ASSETS.USDT.A_TOKEN as string,
  DECIMALS: 6,
  SYMBOL: 'USD₮',
}

export const MANAGER = requireEnv('SCOPED_SPEND_MANAGER_ADDRESS')
export const DELEGATION_ADDRESS = requireEnv('DELEGATION_ADDRESS')
export const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org'
export const BUNDLER_URL = `https://api.pimlico.io/v2/${CHAIN_ID}/rpc?apikey=${requireEnv('PIMLICO_API_KEY')}`
export const POLICY_ID = process.env.POLICY_ID || undefined

// Demo merchants the member can pay. Deterministic, obviously-test addresses.
export const MERCHANTS = [
  { name: 'Corner Store', address: '0x1111000000000000000000000000000000001111' },
  { name: 'Book Shop', address: '0x2222000000000000000000000000000000002222' },
  { name: 'Game Pass', address: '0x3333000000000000000000000000000000003333' },
]

export const provider = new ethers.JsonRpcProvider(RPC_URL)

export const erc20 = new ethers.Interface([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
])
export const faucetIface = new ethers.Interface([
  'function mint(address token, address to, uint256 amount) returns (uint256)',
])
export const poolIface = new ethers.Interface([
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function withdraw(address asset, uint256 amount, address to) returns (uint256)',
])
export const managerIface = new ethers.Interface([
  'function grant(address spender, address asset, address source, uint256 perTxCap, uint256 periodCap, uint256 periodLength, uint256 expiry) returns (bytes32)',
  'function updateScope(bytes32 id, uint256 perTxCap, uint256 periodCap, uint256 periodLength, uint256 expiry)',
  'function setAllowlist(bytes32 id, address[] targets, bool allowed)',
  'function revoke(bytes32 id)',
  'function spend(bytes32 id, address to, uint256 amount)',
  'function requestSpend(bytes32 id, address to, uint256 amount, uint256 ttl) returns (bytes32)',
  'function approveRequest(bytes32 requestId)',
  'function denyRequest(bytes32 requestId)',
  'function spendable(bytes32 id) view returns (uint256)',
  'function periodResetsAt(bytes32 id) view returns (uint64)',
  'function getScope(bytes32 id) view returns (tuple(address funder, address spender, address asset, address source, uint128 perTxCap, uint128 periodCap, uint48 periodLength, uint48 grantedAt, uint48 expiry, bool revoked, uint128 spentInPeriod, uint48 periodStart, uint32 allowlistSize))',
  'event Granted(bytes32 indexed id, address indexed funder, address indexed spender, address asset, address source, uint256 perTxCap, uint256 periodCap, uint256 periodLength, uint256 expiry)',
  'event SpendRequested(bytes32 indexed requestId, bytes32 indexed id, address indexed to, uint256 amount, uint256 expiresAt)',
  'event Spent(bytes32 indexed id, address indexed to, uint256 amount, bytes32 requestId)',
])

export const managerRead = new ethers.Contract(MANAGER, managerIface, provider)
export const assetRead = new ethers.Contract(AAVE.ASSET, erc20, provider)
export const aAssetRead = new ethers.Contract(AAVE.A_ASSET, erc20, provider)

export type Tx = { to: string; value: bigint; data: string }

/** Mint test USD₮ from the Aave faucet, approve the savings position, and
 *  deposit — one batched, sponsored UserOperation, from an account that starts
 *  with nothing at all (not even gas). */
export function buildDepositBatch(parent: string, amount: bigint): Tx[] {
  return [
    { to: AAVE.FAUCET, value: 0n, data: faucetIface.encodeFunctionData('mint', [AAVE.ASSET, parent, amount]) },
    { to: AAVE.ASSET, value: 0n, data: erc20.encodeFunctionData('approve', [AAVE.POOL, amount]) },
    { to: AAVE.POOL, value: 0n, data: poolIface.encodeFunctionData('supply', [AAVE.ASSET, amount, parent, 0]) },
  ]
}

/** Grant a member a scope and (re)bound the manager's aUSDT allowance to the
 *  sum of outstanding period caps — never unlimited. One batched UserOp. */
export function buildGrantBatch(opts: {
  spender: string
  perTxCap: bigint
  periodCap: bigint
  periodLength: bigint
  expiry: bigint
  newAllowanceTotal: bigint
}): Tx[] {
  return [
    { to: AAVE.A_ASSET, value: 0n, data: erc20.encodeFunctionData('approve', [MANAGER, opts.newAllowanceTotal]) },
    {
      to: MANAGER,
      value: 0n,
      data: managerIface.encodeFunctionData('grant', [
        opts.spender, AAVE.ASSET, AAVE.A_ASSET, opts.perTxCap, opts.periodCap, opts.periodLength, opts.expiry,
      ]),
    },
  ]
}

export function buildRevokeBatch(scopeId: string, newAllowanceTotal: bigint): Tx[] {
  return [
    { to: MANAGER, value: 0n, data: managerIface.encodeFunctionData('revoke', [scopeId]) },
    { to: AAVE.A_ASSET, value: 0n, data: erc20.encodeFunctionData('approve', [MANAGER, newAllowanceTotal]) },
  ]
}

export function parseUnits(v: string | number): bigint {
  return ethers.parseUnits(String(v), AAVE.DECIMALS)
}
export function formatUnits(v: bigint): string {
  return ethers.formatUnits(v, AAVE.DECIMALS)
}

/** Pull an event arg out of a userOp receipt's logs. */
export function eventArgFromLogs(logs: Array<{ address: string; topics: string[]; data: string }>, eventName: string, arg: string): string | undefined {
  for (const log of logs) {
    if (log.address.toLowerCase() !== MANAGER.toLowerCase()) continue
    try {
      const parsed = managerIface.parseLog(log)
      if (parsed?.name === eventName) return String(parsed.args[arg])
    } catch { /* not ours */ }
  }
  return undefined
}

/** Map a bundler simulation revert to the manager's named error, in human
 *  words. The revert data hides inside nested error messages as hex. */
const MANAGER_ERRORS: Array<[string, string]> = [
  ['Revoked()', 'The contract refused it: this allowance was revoked on-chain.'],
  ['Expired()', 'The contract refused it: this allowance has expired.'],
  ['OverPerTxCap(uint256,uint256)', 'The contract refused it: over the per-purchase limit.'],
  ['OverPeriodCap(uint256,uint256)', 'The contract refused it: over the limit for this period.'],
  ['RecipientNotAllowed(address)', "The contract refused it: that recipient isn't on the allowed list."],
  ['NotSpender()', 'The contract refused it: this account is not the spender.'],
  ['UnknownId()', 'The contract refused it: unknown allowance.'],
  ['RequestExpired()', 'The contract refused it: this ask expired.'],
  ['TransferFailed()', 'The contract refused it: the funds could not be pulled.'],
]
const SELECTOR_TO_HUMAN = new Map(MANAGER_ERRORS.map(([sig, msg]) => [ethers.id(sig).slice(2, 10), msg]))

export function humanizeManagerRevert(err: unknown): string | null {
  const messages: string[] = []
  for (let e = err as { message?: string; cause?: unknown } | undefined; e; e = e.cause as never) {
    if (typeof e.message === 'string') messages.push(e.message)
  }
  const hex = messages.join(' ').match(/0x[0-9a-fA-F]{8,}/g)?.join('') ?? ''
  for (const [selector, human] of SELECTOR_TO_HUMAN) {
    if (hex.includes(selector)) return human
  }
  return null
}

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var ${name} — copy .env.example and fill it in.`)
  return v
}
