// Evidence for the pool-asset choice documented in the README: on Aave V3
// Sepolia the USDT/USDC/DAI reserves are all far past their supply caps, so
// supply() reverts (Aave error 51) for any amount, and GHO's facilitator
// bucket is full. EURS is the only stable reserve that is active, unfrozen,
// uncapped and faucet-mintable — so it is the demo pot.
//
// Run: node server/verify/aave-reserves.mjs
import { ethers } from 'ethers'
import { AaveV3Sepolia } from '@bgd-labs/aave-address-book'

process.loadEnvFile(new URL('../../.env', import.meta.url).pathname)

const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL)
const probe = ethers.Wallet.createRandom().address

const dataProvider = new ethers.Contract(AaveV3Sepolia.AAVE_PROTOCOL_DATA_PROVIDER, [
  'function getReserveCaps(address) view returns (uint256 borrowCap, uint256 supplyCap)',
  'function getATokenTotalSupply(address) view returns (uint256)',
], provider)
const pool = new ethers.Contract(AaveV3Sepolia.POOL, [
  'function getConfiguration(address) view returns (uint256)',
], provider)
const faucet = new ethers.Interface(['function mint(address,address,uint256) returns (uint256)'])
const erc20 = new ethers.Interface(['function balanceOf(address) view returns (uint256)'])

console.log('Aave V3 Sepolia reserve survey\n')
console.log('asset    supplyCap        supplied       headroom     flags                mint')
console.log('─'.repeat(88))

for (const [name, asset] of Object.entries(AaveV3Sepolia.ASSETS)) {
  const dec = Number(asset.decimals)
  const [caps, supplied, config] = await Promise.all([
    dataProvider.getReserveCaps(asset.UNDERLYING),
    dataProvider.getATokenTotalSupply(asset.UNDERLYING),
    pool.getConfiguration(asset.UNDERLYING),
  ])
  const bit = (n) => ((config >> BigInt(n)) & 1n) === 1n
  const capUnits = caps.supplyCap * 10n ** BigInt(dec)
  const headroom = caps.supplyCap === 0n ? 'uncapped' : fmt(capUnits - supplied, dec)

  let mintable = 'ok'
  try {
    await provider.call({
      to: AaveV3Sepolia.FAUCET,
      from: probe,
      data: faucet.encodeFunctionData('mint', [asset.UNDERLYING, probe, 10n ** BigInt(dec)]),
    })
  } catch (e) {
    mintable = 'REVERTS: ' + (e.shortMessage ?? e.message).slice(0, 28)
  }

  const flags = [bit(56) ? 'active' : 'INACTIVE', bit(57) ? 'FROZEN' : '', bit(60) ? 'PAUSED' : '']
    .filter(Boolean).join('/')

  console.log(
    name.padEnd(8),
    caps.supplyCap.toString().padStart(12),
    fmt(supplied, dec).padStart(16),
    String(headroom).padStart(14),
    flags.padEnd(20),
    mintable,
  )
}

const eurs = AaveV3Sepolia.ASSETS.EURS
const liquidity = BigInt(
  await provider.call({ to: eurs.UNDERLYING, data: erc20.encodeFunctionData('balanceOf', [eurs.A_TOKEN]) }),
)
console.log(`\nEURS withdrawable liquidity right now: ${fmt(liquidity, Number(eurs.decimals))}`)
console.log('A negative headroom means supply() reverts with Aave error 51 for ANY amount.')

function fmt(v, dec) {
  const s = ethers.formatUnits(v, dec)
  return s.includes('.') ? s.slice(0, s.indexOf('.') + 3) : s
}
