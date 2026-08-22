import { ethers } from 'ethers'
import { AaveV3Sepolia } from '@bgd-labs/aave-address-book'
const p = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL ?? (process.loadEnvFile('.env'), process.env.SEPOLIA_RPC_URL))
const dp = new ethers.Contract(AaveV3Sepolia.AAVE_PROTOCOL_DATA_PROVIDER, [
  'function getReserveCaps(address) view returns (uint256 borrowCap, uint256 supplyCap)',
  'function getATokenTotalSupply(address) view returns (uint256)',
  'function getPaused(address) view returns (bool)',
], p)
for (const [name, a] of Object.entries(AaveV3Sepolia.ASSETS)) {
  try {
    const [caps, total] = await Promise.all([dp.getReserveCaps(a.UNDERLYING), dp.getATokenTotalSupply(a.UNDERLYING)])
    const dec = BigInt(a.decimals)
    const capUnits = caps.supplyCap * 10n ** dec
    const headroom = capUnits > 0n ? capUnits - total : null
    console.log(name.padEnd(8), 'cap:', caps.supplyCap.toString().padStart(12), 'supplied:', ethers.formatUnits(total, a.decimals).padStart(18), 'headroom:', headroom === null ? 'UNCAPPED' : ethers.formatUnits(headroom, a.decimals))
  } catch (e) { console.log(name, 'ERR', (e.shortMessage || e.message).slice(0, 50)) }
}
