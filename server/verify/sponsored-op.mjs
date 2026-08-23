// Spike 0 — a fully sponsored UserOperation from a fresh, zero-balance EOA.
// Pass = userOp hash + successful receipt. Nothing else in the project starts
// until this exits 0. Tries the configured sponsorship policy first, then
// falls back to no policy so we learn which mode works.
import WDK from '@tetherto/wdk'
import WalletManagerEvm7702Gasless from '@tetherto/wdk-wallet-evm-7702-gasless'

process.loadEnvFile(new URL('../../.env', import.meta.url).pathname)

const CANONICAL_DELEGATE = '0xe6Cae83BdE06E4c305530e199D7217f42808555B'
const bundlerUrl = `https://api.pimlico.io/v2/11155111/rpc?apikey=${process.env.PIMLICO_API_KEY}`

async function attempt(label, extraCfg) {
  const seed = WDK.getRandomSeedPhrase(12)
  const wdk = new WDK(seed).registerWallet('ethereum', WalletManagerEvm7702Gasless, {
    provider: process.env.SEPOLIA_RPC_URL,
    bundlerUrl,
    delegationAddress: process.env.DELEGATION_ADDRESS || CANONICAL_DELEGATE,
    isSponsored: true,
    ...extraCfg,
  })
  try {
    const account = await wdk.getAccount('ethereum', 0)
    const address = await account.getAddress()
    console.log(`[${label}] fresh address: ${address}`)

    const quote = await account.quoteSendTransaction({ to: address, value: 0n, data: '0x' })
    console.log(`[${label}] quoted fee: ${quote.fee} (expected 0 for sponsored)`)

    const result = await account.sendTransaction({ to: address, value: 0n, data: '0x' })
    console.log(`[${label}] userOp hash: ${result.hash}`)

    const receipt = await account.waitForTransaction(result.hash)
    console.log(`[${label}] success: ${receipt.success}, block tx: ${receipt.receipt?.hash}`)
    if (!receipt.success) throw new Error('userOp reverted')
    return true
  } finally {
    wdk.dispose()
  }
}

const policyId = process.env.POLICY_ID
let ok = false
if (policyId) {
  ok = await attempt(`policy:${policyId}`, { sponsorshipPolicyId: policyId }).catch((e) => {
    console.error(`[policy] FAILED: ${e.message}`)
    return false
  })
}
if (!ok) {
  ok = await attempt('no-policy', {}).catch((e) => {
    console.error(`[no-policy] FAILED: ${e.message}`)
    return false
  })
}
console.log(ok ? '\nSPIKE 0 PASS' : '\nSPIKE 0 FAIL')
process.exit(ok ? 0 : 1)
