// Spike 1 — Aave Sepolia round trip, all gasless, from a fresh parent account:
//   op1 (batched): faucet.mint(100 ASSET) + ASSET.approve(pool) + pool.supply
//   op2:           pool.withdraw(1 ASSET, → merchant)  — pays a third party directly
// Probes (recorded, non-fatal):
//   A: non-zero → non-zero approve on ASSET and aASSET (approve-to-zero requirement?)
//   B: is Pimlico's USD₮ (gas token) publicly mintable?
import WDK from '@tetherto/wdk'
import WalletManagerEvm7702Gasless from '@tetherto/wdk-wallet-evm-7702-gasless'
import { ethers } from 'ethers'
import { AaveV3Sepolia } from '@bgd-labs/aave-address-book'

process.loadEnvFile(new URL('../.env', import.meta.url).pathname)

const CANONICAL_DELEGATE = '0xe6Cae83BdE06E4c305530e199D7217f42808555B'
const PIMLICO_USDT = '0xd077A400968890Eacc75cdc901F0356c943e4fDb'
// Pool asset: EURS — the only viable stable reserve on Aave Sepolia (see SPEC.md deviation 5)
const ASSET = AaveV3Sepolia.ASSETS.EURS.UNDERLYING
const A_ASSET = AaveV3Sepolia.ASSETS.EURS.A_TOKEN
const DEC = 2
const POOL = AaveV3Sepolia.POOL
const FAUCET = AaveV3Sepolia.FAUCET

const erc20 = new ethers.Interface([
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
])
const faucet = new ethers.Interface(['function mint(address,address,uint256) returns (uint256)'])
const pool = new ethers.Interface([
  'function supply(address,uint256,address,uint16)',
  'function withdraw(address,uint256,address) returns (uint256)',
])

const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL)
const seed = WDK.getRandomSeedPhrase(12)
const wdk = new WDK(seed).registerWallet('ethereum', WalletManagerEvm7702Gasless, {
  provider: process.env.SEPOLIA_RPC_URL,
  bundlerUrl: `https://api.pimlico.io/v2/11155111/rpc?apikey=${process.env.PIMLICO_API_KEY}`,
  delegationAddress: process.env.DELEGATION_ADDRESS || CANONICAL_DELEGATE,
  isSponsored: true,
  sponsorshipPolicyId: process.env.POLICY_ID || undefined,
})


// Pimlico's eth_getUserOperationByHash lags/returns null for included ops, which
// stalls WDK's waitForTransaction (it polls byHash first). Poll the receipt
// endpoint directly instead — it is prompt and authoritative.
async function waitForUserOp (account, hash, { timeout = 300_000, interval = 4_000 } = {}) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const receipt = await account.getUserOperationReceipt(hash).catch(() => null)
    if (receipt) return { success: receipt.success, receipt: { hash: receipt.receipt?.transactionHash } }
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error(`userOp ${hash} not included within ${timeout / 1000}s`)
}


const bal = (token, who) => provider.call({ to: token, data: erc20.encodeFunctionData('balanceOf', [who]) }).then((r) => BigInt(r))

try {
  const account = await wdk.getAccount('ethereum', 0)
  const parent = await account.getAddress()
  const merchant = ethers.Wallet.createRandom().address
  console.log('parent (fresh):', parent, '\nmerchant:', merchant)

  const AMOUNT = 100_00n // 100.00 EURS (2 decimals)
  console.log('\n— op1: mint + approve + supply (EURS) (one sponsored UserOp) —')
  const t0 = Date.now()
  const op1 = await account.sendTransaction([
    { to: FAUCET, value: 0n, data: faucet.encodeFunctionData('mint', [ASSET, parent, AMOUNT]) },
    { to: ASSET, value: 0n, data: erc20.encodeFunctionData('approve', [POOL, AMOUNT]) },
    { to: POOL, value: 0n, data: pool.encodeFunctionData('supply', [ASSET, AMOUNT, parent, 0]) },
  ])
  const r1 = await waitForUserOp(account, op1.hash)
  console.log('op1 success:', r1.success, r1.receipt?.hash, 'latency:', Math.round((Date.now() - t0) / 1000) + 's')
  if (!r1.success) throw new Error('op1 reverted')
  console.log('parent aEURS:', ethers.formatUnits(await bal(A_ASSET, parent), DEC))

  console.log('\n— op2: withdraw 1 ASSET straight to merchant —')
  const op2 = await account.sendTransaction({
    to: POOL, value: 0n, data: pool.encodeFunctionData('withdraw', [ASSET, 1_00n, merchant]),
  })
  const r2 = await waitForUserOp(account, op2.hash)
  console.log('op2 success:', r2.success, r2.receipt?.hash)
  if (!r2.success) throw new Error('op2 reverted')
  const merchantBal = await bal(ASSET, merchant)
  console.log('merchant ASSET:', ethers.formatUnits(merchantBal, DEC))
  if (merchantBal !== 1_00n) throw new Error('merchant did not receive exactly 1 ASSET')

  console.log('\n— probe A: non-zero → non-zero approve (EURS + aEURS) —')
  const spender = ethers.Wallet.createRandom().address
  const probeA = await account.sendTransaction([
    { to: ASSET, value: 0n, data: erc20.encodeFunctionData('approve', [spender, 5n]) },
    { to: A_ASSET, value: 0n, data: erc20.encodeFunctionData('approve', [spender, 5n]) },
  ])
  await waitForUserOp(account, probeA.hash)
  const probeA2 = await account
    .sendTransaction([
      { to: ASSET, value: 0n, data: erc20.encodeFunctionData('approve', [spender, 7n]) },
      { to: A_ASSET, value: 0n, data: erc20.encodeFunctionData('approve', [spender, 7n]) },
    ])
    .then((r) => waitForUserOp(account, r.hash))
  console.log('non-zero → non-zero approve:', probeA2.success ? 'ALLOWED (no approve-to-zero needed)' : 'REVERTED (must approve(0) first)')

  console.log('\n— probe B: Pimlico USD₮ mintable? (answered: owner-only; kept for the record) —')
  for (const [sig, data] of [
    ['mint(address,uint256)', new ethers.Interface(['function mint(address,uint256)']).encodeFunctionData('mint', [parent, 1_000000n])],
    ['mint(uint256)', new ethers.Interface(['function mint(uint256)']).encodeFunctionData('mint', [1_000000n])],
  ]) {
    try {
      await provider.call({ to: PIMLICO_USDT, data, from: parent })
      console.log(`  ${sig}: WOULD SUCCEED`)
    } catch (e) {
      console.log(`  ${sig}: reverts (${(e.shortMessage || e.message).slice(0, 60)})`)
    }
  }

  console.log('\nSPIKE 1 PASS')
} finally {
  wdk.dispose()
}
