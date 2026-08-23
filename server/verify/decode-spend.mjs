// Decode a member's payment so the settlement path is visible: aUSDT leaves
// the parent, Aave burns it, and USD₮ lands with the merchant — one tx.
//   node server/verify/decode-spend.mjs <txHash>
import { ethers } from 'ethers'

process.loadEnvFile(new URL('../../.env', import.meta.url).pathname)

const hash = process.argv[2]
if (!hash) {
  console.error('usage: node server/verify/decode-spend.mjs <txHash>')
  process.exit(1)
}

const p = new ethers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC_URL)
const erc = new ethers.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)'])
const meta = new ethers.Interface(['function symbol() view returns (string)'])

const receipt = await p.getTransactionReceipt(hash)
if (!receipt) {
  console.error('no receipt for that hash on Base Sepolia')
  process.exit(1)
}

const symbols = new Map()
console.log(`status ${receipt.status} · token movements:`)
for (const log of receipt.logs) {
  let parsed
  try { parsed = erc.parseLog(log) } catch { continue }
  if (!parsed) continue
  if (!symbols.has(log.address)) {
    let sym = log.address.slice(0, 8)
    try {
      sym = meta.decodeFunctionResult('symbol', await p.call({ to: log.address, data: meta.encodeFunctionData('symbol', []) }))[0]
    } catch { /* not an ERC-20 with symbol() */ }
    symbols.set(log.address, sym)
  }
  const zero = '0x0000000000000000000000000000000000000000'
  const label = (a) => (a === zero ? 'burned  ' : `${a.slice(0, 8)}…`)
  console.log(`  ${symbols.get(log.address).padEnd(8)} ${label(parsed.args.from)} → ${label(parsed.args.to)}  ${ethers.formatUnits(parsed.args.value, 6)}`)
}
