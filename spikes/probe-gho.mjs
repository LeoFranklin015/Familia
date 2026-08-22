process.loadEnvFile('.env')
import { ethers } from 'ethers'
import { AaveV3Sepolia } from '@bgd-labs/aave-address-book'
const p = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL)
const me = ethers.Wallet.createRandom().address
const pool = new ethers.Contract(AaveV3Sepolia.POOL, ['function getConfiguration(address) view returns (uint256)'], p)
const f = new ethers.Interface(['function mint(address,address,uint256) returns (uint256)'])
for (const name of ['GHO', 'EURS']) {
  const a = AaveV3Sepolia.ASSETS[name]
  const conf = await pool.getConfiguration(a.UNDERLYING)
  const bit = (n) => ((conf >> BigInt(n)) & 1n) === 1n
  let mint = 'n/a'
  try { await p.call({ to: AaveV3Sepolia.FAUCET, data: f.encodeFunctionData('mint', [a.UNDERLYING, me, 1000n * 10n ** BigInt(a.decimals)]), from: me }); mint = 'MINTABLE' }
  catch (e) { mint = 'mint reverts: ' + (e.shortMessage || e.message).slice(0, 40) }
  console.log(name, '| active:', bit(56), '| frozen:', bit(57), '| paused:', bit(60), '| decimals:', a.decimals, '|', mint)
}
