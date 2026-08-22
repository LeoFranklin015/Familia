process.loadEnvFile('.env')
import { ethers } from 'ethers'
import { AaveV3Sepolia } from '@bgd-labs/aave-address-book'
const p = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL)
const parent = '0x22cd901506b9e66C654B96B6CBa32eb4f0e98C1d'
const erc = new ethers.Interface(['function balanceOf(address) view returns (uint256)'])
const b = BigInt(await p.call({ to: AaveV3Sepolia.ASSETS.EURS.A_TOKEN, data: erc.encodeFunctionData('balanceOf', [parent]) }))
console.log('parent aEURS:', ethers.formatUnits(b, 2))
