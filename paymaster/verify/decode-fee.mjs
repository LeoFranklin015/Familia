// Show who paid for each operation: which paymaster covered it, and whether
// the sender was charged in USD₮ or sponsored outright.
//   node paymaster/verify/decode-fee.mjs <txHash> [<txHash> ...]
import { ethers } from 'ethers'

process.loadEnvFile(new URL('../../.env', import.meta.url).pathname)

const p = new ethers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC_URL)
const OURS = (process.env.USDT_PAYMASTER_ADDRESS ?? '').toLowerCase()
const USDT = '0x0a215D8ba66387DCA84B284D18c3B4ec3de6E54a'

const ep = new ethers.Interface([
  'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)',
])
const erc = new ethers.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)'])

for (const hash of process.argv.slice(2)) {
  const r = await p.getTransactionReceipt(hash)
  if (!r) { console.log(`${hash.slice(0, 12)}… no receipt`); continue }

  for (const log of r.logs) {
    let ev
    try { ev = ep.parseLog(log) } catch { continue }
    if (!ev || ev.name !== 'UserOperationEvent') continue

    const pm = String(ev.args.paymaster).toLowerCase()
    const who = pm === OURS ? 'OUR USD₮ paymaster' : `Pimlico (${pm.slice(0, 10)}…)`

    // Did the sender actually part with USD₮ for the fee?
    let feePaid = 0n
    for (const l2 of r.logs) {
      if (l2.address.toLowerCase() !== USDT.toLowerCase()) continue
      let t
      try { t = erc.parseLog(l2) } catch { continue }
      if (t && String(t.args.from).toLowerCase() === String(ev.args.sender).toLowerCase()
          && String(t.args.to).toLowerCase() === pm) feePaid += t.args.value
    }

    console.log(`${hash.slice(0, 12)}…  success=${ev.args.success}  via ${who}`)
    console.log(`   gas cost ${ethers.formatEther(ev.args.actualGasCost)} ETH`)
    console.log(`   sender charged: ${feePaid === 0n ? 'nothing (sponsored)' : ethers.formatUnits(feePaid, 6) + ' USD₮'}\n`)
  }
}
