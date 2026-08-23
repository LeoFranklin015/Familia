// Where this app lives on-chain: addresses, endpoints, the provider, and the
// one unit everything is denominated in.
//
// Token addresses come from the canonical Aave address book, never pasted hex.
//
// Base Sepolia. The family money is USD₮ supplied to Aave V3's real pool, so
// the guardian holds genuine aUSDT and a member's spend redeems it through
// Aave itself — no vault of ours anywhere in the path.
//
// Why not Ethereum Sepolia: its Aave USDT reserve sits about twice over its
// supply cap and reverts with error 51 for any amount, as do USDC and DAI.
// Base Sepolia's USDT reserve is uncapped, faucet-mintable and liquid. The
// trade is that no provider prices gas in USD₮ here, which is why we run our
// own paymaster.
import { ethers } from 'ethers'
import { AaveV3BaseSepolia } from '@bgd-labs/aave-address-book'

// Read at import time: ESM hoists imports, so loading it from index.ts would
// be too late for the constants below.
try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url).pathname)
} catch { /* fine where the vars are exported directly */ }

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
  // Plain ticker: ₮ (U+20AE) is outside the UI font's subset and would
  // render in a fallback face beside every figure.
  SYMBOL: 'USDT',
}

export const MANAGER = requireEnv('SCOPED_SPEND_MANAGER_ADDRESS')
export const DELEGATION_ADDRESS = requireEnv('DELEGATION_ADDRESS')
export const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org'
export const BUNDLER_URL = `https://api.pimlico.io/v2/${CHAIN_ID}/rpc?apikey=${requireEnv('PIMLICO_API_KEY')}`
export const POLICY_ID = process.env.POLICY_ID || undefined

/** Our own USD₮ paymaster, and the ERC-7677 service in front of it. No
 *  provider prices gas in USD₮ on this chain, so we run one. */
export const USDT_PAYMASTER = process.env.USDT_PAYMASTER_ADDRESS || ''
export const PAYMASTER_SERVICE_URL =
  process.env.PAYMASTER_SERVICE_URL || `http://localhost:${process.env.PORT ?? 8787}/paymaster`

/**
 * The chain id is a constant in this file, so tell ethers rather than letting
 * it ask. Left to detect, it issues a real `eth_chainId` before every call
 * wave — three per `/api/state`, eight per write.
 */
export const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true })

export function parseUnits(v: string | number): bigint {
  return ethers.parseUnits(String(v), AAVE.DECIMALS)
}
export function formatUnits(v: bigint): string {
  return ethers.formatUnits(v, AAVE.DECIMALS)
}

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var ${name}. Copy .env.example and fill it in.`)
  return v
}
