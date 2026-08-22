// Spike 3 — pay gas in USD₮ on Base Sepolia through a paymaster we run
// ourselves, because no provider prices gas in USD₮ on this chain.
//
// The account starts with nothing. It mints test USD₮ from Aave's faucet in a
// sponsored operation (bootstrapping: you cannot pay a USD₮ fee before you
// hold USD₮), approves our paymaster, and from then on pays its own gas in
// USD₮ with no native coin at any point.
//
// Pass = a USD₮-denominated fee quote, a receipt, and the account's USD₮
// balance visibly reduced by the fee.
//
// Needs the server running so the ERC-7677 service is reachable:
//   cd server && bun run start
//   node spikes/spike3-own-usdt-paymaster.mjs
import WDK from '@tetherto/wdk'
import WalletManagerEvm7702Gasless from '@tetherto/wdk-wallet-evm-7702-gasless'
import { ethers } from 'ethers'
import { AaveV3BaseSepolia } from '@bgd-labs/aave-address-book'

process.loadEnvFile(new URL('../.env', import.meta.url).pathname)

const CHAIN_ID = 84532
const FAUCET = '0xD9145b5F45Ad4519c7ACcD6E0A4A82e83bB8A6Dc'
const USDT = AaveV3BaseSepolia.ASSETS.USDT.UNDERLYING
const PAYMASTER = process.env.USDT_PAYMASTER_ADDRESS
const SERVICE = process.env.PAYMASTER_SERVICE_URL ?? 'http://localhost:8787/paymaster'
const DELEGATE = process.env.DELEGATION_ADDRESS

const rpc = process.env.BASE_SEPOLIA_RPC_URL
const provider = new ethers.JsonRpcProvider(rpc)
const erc20 = new ethers.Interface([
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
])
const faucet = new ethers.Interface(['function mint(address,address,uint256) returns (uint256)'])

const usdtOf = async (who) =>
  BigInt(await provider.call({ to: USDT, data: erc20.encodeFunctionData('balanceOf', [who]) }))

const base = {
  provider: rpc,
  bundlerUrl: `https://api.pimlico.io/v2/${CHAIN_ID}/rpc?apikey=${process.env.PIMLICO_API_KEY}`,
  delegationAddress: DELEGATE,
}

// Two views of the same key: one sponsored (to bootstrap), one paying in USD₮.
const seed = WDK.getRandomSeedPhrase(12)
const sponsored = new WDK(seed).registerWallet('ethereum', WalletManagerEvm7702Gasless, {
  ...base,
  isSponsored: true,
  ...(process.env.POLICY_ID ? { sponsorshipPolicyId: process.env.POLICY_ID } : {}),
})
const payingInUsdt = new WDK(seed).registerWallet('ethereum', WalletManagerEvm7702Gasless, {
  ...base,
  isSponsored: false,
  paymasterUrl: SERVICE,
  paymasterAddress: PAYMASTER, // pin it: throws if the service names anything else
  paymasterToken: { address: USDT },
})

async function waitForUserOp(account, hash, timeout = 240_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const r = await account.getUserOperationReceipt(hash).catch(() => null)
    if (r) return { success: r.success, txHash: r.receipt?.transactionHash }
    await new Promise((res) => setTimeout(res, 4000))
  }
  throw new Error(`userOp ${hash} not included in ${timeout / 1000}s`)
}

try {
  const boot = await sponsored.getAccount('ethereum', 0)
  const payer = await payingInUsdt.getAccount('ethereum', 0)
  const address = await boot.getAddress()
  console.log('fresh account:', address)
  console.log('native balance:', ethers.formatEther(await provider.getBalance(address)), '(zero, and stays zero)\n')

  console.log('— bootstrap: mint USD₮ and approve the paymaster, sponsored —')
  const boot1 = await boot.sendTransaction([
    { to: FAUCET, value: 0n, data: faucet.encodeFunctionData('mint', [USDT, address, 50_000000n]) },
    { to: USDT, value: 0n, data: erc20.encodeFunctionData('approve', [PAYMASTER, 50_000000n]) },
  ])
  const r1 = await waitForUserOp(boot, boot1.hash)
  if (!r1.success) throw new Error('bootstrap op reverted')
  const before = await usdtOf(address)
  console.log('  ok:', r1.txHash)
  console.log('  USD₮ held:', ethers.formatUnits(before, 6), '\n')

  console.log('— now pay gas in USD₮ through our own paymaster —')
  const tx = { to: address, value: 0n, data: '0x' }
  const quote = await payer.quoteSendTransaction(tx)
  console.log('  quoted fee:', quote.fee, `= ${ethers.formatUnits(quote.fee, 6)} USD₮`)
  if (quote.fee === 0n) throw new Error('a token-mode quote should not be zero')

  const sent = await payer.sendTransaction(tx)
  console.log('  userOp:', sent.hash)
  const r2 = await waitForUserOp(payer, sent.hash)
  console.log('  success:', r2.success, r2.txHash)
  if (!r2.success) throw new Error('USD₮-paid op reverted')

  const after = await usdtOf(address)
  const paid = before - after
  console.log('\n  USD₮ before:', ethers.formatUnits(before, 6))
  console.log('  USD₮ after: ', ethers.formatUnits(after, 6))
  console.log('  fee paid:   ', ethers.formatUnits(paid, 6), 'USD₮')
  console.log('  native spent:', ethers.formatEther(await provider.getBalance(address)), '(never held any)')
  if (paid <= 0n) throw new Error('no USD₮ was actually charged')

  console.log('\nSPIKE 3 PASS — gas paid in USD₮, no native coin ever held')
} finally {
  sponsored.dispose()
  payingInUsdt.dispose()
}
