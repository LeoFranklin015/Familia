process.loadEnvFile('.env')
import { ethers } from 'ethers'
import { AaveV3Sepolia } from '@bgd-labs/aave-address-book'
const p = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL)
const me = ethers.Wallet.createRandom().address
const PIM = '0xd077A400968890Eacc75cdc901F0356c943e4fDb'

console.log('— Pimlico USD₮ obtainability —')
const tries = [
  ['mint(address,uint256)', ['function mint(address,uint256)'], [me, 500_000000n]],
  ['mint(uint256)', ['function mint(uint256)'], [500_000000n]],
  ['drip(address)', ['function drip(address)'], [me]],
  ['drip()', ['function drip()'], []],
  ['claim()', ['function claim()'], []],
  ['faucet()', ['function faucet()'], []],
]
for (const [name, abi, args] of tries) {
  const i = new ethers.Interface(abi)
  try { await p.call({ to: PIM, data: i.encodeFunctionData(name.split('(')[0], args), from: me }); console.log(' ', name, 'WOULD SUCCEED') }
  catch (e) { console.log(' ', name, 'reverts/absent:', (e.shortMessage || e.message).slice(0, 50)) }
}

console.log('\n— EURS reserve viability —')
const EURS = AaveV3Sepolia.ASSETS.EURS
const erc = new ethers.Interface(['function balanceOf(address) view returns (uint256)'])
const liq = BigInt(await p.call({ to: EURS.UNDERLYING, data: erc.encodeFunctionData('balanceOf', [EURS.A_TOKEN]) }))
console.log('  EURS available liquidity:', ethers.formatUnits(liq, EURS.decimals))
const f = new ethers.Interface(['function mint(address,address,uint256) returns (uint256)'])
try { await p.call({ to: AaveV3Sepolia.FAUCET, data: f.encodeFunctionData('mint', [EURS.UNDERLYING, me, 50000n]), from: me }); console.log('  faucet.mint(EURS) WOULD SUCCEED') }
catch (e) { console.log('  faucet.mint(EURS) reverts:', (e.shortMessage || e.message).slice(0, 60)) }
