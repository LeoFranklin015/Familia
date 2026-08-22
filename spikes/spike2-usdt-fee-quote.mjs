// Spike 2 — the USD₮ fee path, on Ethereum Sepolia where a paymaster prices
// gas in USD₮ (`0xd077A4…`, the token Pimlico and Candide both accept).
//
// Two things are demonstrated:
//   1. A fee QUOTE denominated in USD₮, obtained without holding any of it.
//      This is the Track 2 goal "show the fee quote in USD₮ before signing".
//   2. What actually happens on send: the paymaster rejects with AA50 because
//      the account holds no USD₮. That token is owner-only-mint and its owner
//      is an EOA, so no entrant can obtain it — which is exactly why the app
//      itself runs fully sponsored on Base Sepolia instead.
//
// Run: node spikes/spike2-usdt-fee-quote.mjs
import WDK from '@tetherto/wdk'
import WalletManagerEvm7702Gasless from '@tetherto/wdk-wallet-evm-7702-gasless'

process.loadEnvFile(new URL('../.env', import.meta.url).pathname)

const CHAIN_ID = 11155111
const PIMLICO_USDT = '0xd077A400968890Eacc75cdc901F0356c943e4fDb'
const CANONICAL_DELEGATE = '0xe6Cae83BdE06E4c305530e199D7217f42808555B'

const seed = WDK.getRandomSeedPhrase(12)
const wdk = new WDK(seed).registerWallet('ethereum', WalletManagerEvm7702Gasless, {
  provider: process.env.SEPOLIA_RPC_URL,
  bundlerUrl: `https://api.pimlico.io/v2/${CHAIN_ID}/rpc?apikey=${process.env.PIMLICO_API_KEY}`,
  delegationAddress: CANONICAL_DELEGATE,
  // Base config is sponsored; the token mode below is a per-call override.
  isSponsored: true,
})

try {
  const account = await wdk.getAccount('ethereum', 0)
  const address = await account.getAddress()
  console.log('fresh account:', address, '(holds nothing at all)\n')

  const tx = { to: address, value: 0n, data: '0x' }

  console.log('— fee quoted in the sponsored mode —')
  const sponsored = await account.quoteSendTransaction(tx)
  console.log('  fee:', sponsored.fee, '(0n — someone else pays)\n')

  console.log('— same operation, fee quoted in USD₮ —')
  // Switching a sponsored account to token mode for one call requires
  // isSponsored: false alongside the token; it shallow-merges over the config.
  const tokenMode = {
    isSponsored: false,
    paymasterToken: { address: PIMLICO_USDT },
  }
  const quote = await account.quoteSendTransaction(tx, tokenMode)
  console.log('  fee:', quote.fee, `= ${Number(quote.fee) / 1e6} USD₮`)
  console.log('  → a user could be shown this before signing, holding no ETH\n')

  console.log('— attempting the send in USD₮ mode —')
  try {
    const res = await account.sendTransaction(tx, tokenMode)
    console.log('  sent:', res.hash, '(the account must have held USD₮)')
  } catch (e) {
    const msg = e?.message ?? String(e)
    console.log('  rejected as expected:', msg.slice(0, 120))
    console.log('  → the quote is real; only the USD₮ balance is missing, and')
    console.log('    that token cannot be minted by anyone but its owner.')
  }
  console.log('\nSPIKE 2 PASS — USD₮-denominated fee quoting works')
} finally {
  wdk.dispose()
}
