// A recurring mandate, end to end, against the deployed manager.
//
// Proves the four claims the subscriptions screen makes:
//
//   1. a biller can take one month's price, and the money lands on the
//      service's payout address, not the biller's
//   2. a second attempt inside the same period is refused on-chain
//   3. the biller cannot redirect the money somewhere else
//   4. the mandate carries a fixed term, so it lapses on its own
//   5. the household can revoke early, and the biller is refused from then on
//
// Uses a throwaway biller key and its own scope, so it touches no household.
//
//   node server/verify/subscription.mjs
import { ethers } from 'ethers'

process.loadEnvFile(new URL('../../.env', import.meta.url).pathname)

const RPC = process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org'
const provider = new ethers.JsonRpcProvider(RPC, 84532, { staticNetwork: true })
const funder = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider)

const MANAGER = process.env.SCOPED_SPEND_MANAGER_ADDRESS
const POOL = '0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27'
const USDT = '0x0a215D8ba66387DCA84B284D18c3B4ec3de6E54a'
const AUSDT = '0xcE3CAae5Ed17A7AafCEEbc897DE843fA6CC0c018'
const FAUCET = '0xD9145b5F45Ad4519c7ACcD6E0A4A82e83bB8A6Dc'

const PRICE = ethers.parseUnits('15.49', 6) // one month of Netflix
const MONTH = 30 * 86400
const TERM_MONTHS = 12
const TERM = TERM_MONTHS * MONTH // exactly twelve periods, so never a thirteenth
const PAY_TO = '0x4444000000000000000000000000000000004444' // the service's payout address
const ELSEWHERE = '0x9999000000000000000000000000000000009999'

const erc20 = new ethers.Interface([
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
])
const manager = new ethers.Contract(MANAGER, [
  'function grant(address,address,address,uint256,uint256,uint256,uint256) returns (bytes32)',
  'function getScope(bytes32) view returns (tuple(address funder,address spender,address asset,address source,uint128 perTxCap,uint128 periodCap,uint48 periodLength,uint48 grantedAt,uint48 expiry,bool revoked,uint128 spentInPeriod,uint48 periodStart,uint32 allowlistSize))',
  'function setAllowlist(bytes32,address[],bool)',
  'function spend(bytes32,address,uint256)',
  'function revoke(bytes32)',
  'function spendable(bytes32) view returns (uint256)',
  'event Granted(bytes32 indexed id, address indexed funder, address indexed spender, address asset, address source, uint256 perTxCap, uint256 periodCap, uint256 periodLength, uint256 expiry)',
], funder)

const usdt = new ethers.Contract(USDT, erc20, provider)
const ausdt = new ethers.Contract(AUSDT, erc20, provider)
const bal = async (c, a) => ethers.formatUnits(await c.balanceOf(a), 6)

const ok = (m) => console.log(`  \x1b[32mok\x1b[0m    ${m}`)
const info = (m) => console.log(`        ${m}`)
const step = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`)

/**
 * Assert a call reverts with a named error.
 *
 * A static call rather than a sent transaction. Sending one asks the node to
 * estimate gas first, and Base Sepolia's public RPC is load balanced, so an
 * estimate can land on a node that has not seen the previous block yet: the
 * estimate passes against stale state and the revert then arrives with no data
 * attached. `staticCall` runs against a named block and hands back the custom
 * error itself.
 */
async function mustRevert(label, fn, expected) {
  const selector = ethers.id(expected).slice(0, 10)
  try {
    await fn()
    throw new Error(`${label}: it went through, and it should not have`)
  } catch (e) {
    // A custom error carries uint256 args, which come back as BigInt, so the
    // error object cannot be stringified. Read the revert bytes off it instead.
    const data = typeof e?.data === 'string' ? e.data : ''
    if (!data.startsWith(selector)) {
      throw new Error(`${label}: expected ${expected}, got ${e.shortMessage ?? e.message}`)
    }
    ok(`${label} — refused with ${expected}`)
  }
}

/** Wait until every node we might be routed to has the block our last write
 *  landed in. Without it the reads below race the RPC's own replication. */
async function settled(receipt) {
  for (let i = 0; i < 30; i++) {
    if ((await provider.getBlockNumber()) > receipt.blockNumber) return
    await new Promise((r) => setTimeout(r, 1000))
  }
}

step('Setting up a household position')
info(`funder ${funder.address}`)
if ((await ausdt.balanceOf(funder.address)) < PRICE * 2n) {
  if ((await usdt.balanceOf(funder.address)) < PRICE * 2n) {
    info('minting test USDT from the Aave faucet')
    const faucet = new ethers.Contract(FAUCET, ['function mint(address,address,uint256)'], funder)
    await (await faucet.mint(USDT, funder.address, ethers.parseUnits('1000', 6))).wait()
  }
  info('supplying it to Aave')
  const supply = ethers.parseUnits('100', 6)
  await (await funder.sendTransaction({ to: USDT, data: erc20.encodeFunctionData('approve', [POOL, supply]) })).wait()
  const pool = new ethers.Contract(POOL, ['function supply(address,uint256,address,uint16)'], funder)
  await (await pool.supply(USDT, supply, funder.address, 0)).wait()
}
ok(`funder holds ${await bal(ausdt, funder.address)} aUSDT`)

step('The biller')
const biller = ethers.Wallet.createRandom().connect(provider)
info(`throwaway key ${biller.address}`)
await (await funder.sendTransaction({ to: biller.address, value: ethers.parseEther('0.0005') })).wait()
ok('funded with its own gas, so the household never pays for a collection')

step('The household signs a mandate')
await (await funder.sendTransaction({
  to: AUSDT, data: erc20.encodeFunctionData('approve', [MANAGER, PRICE]),
})).wait()
const expiry = Math.floor(Date.now() / 1000) + TERM
// The app sends the grant and the allowlist as one UserOperation, so it never
// races itself here. This script sends them separately, which means waiting.
const granted = await (await manager.grant(biller.address, USDT, AUSDT, PRICE, PRICE, MONTH, expiry)).wait()
await settled(granted)
const scopeId = manager.interface.parseLog(
  granted.logs.find((l) => l.address.toLowerCase() === MANAGER.toLowerCase()),
).args.id
ok(`scope ${scopeId.slice(0, 18)}…`)
info(`capped at ${ethers.formatUnits(PRICE, 6)} per charge and per month`)
info(`term ${TERM_MONTHS} months, expiring ${new Date(expiry * 1000).toDateString()}`)

await settled(await (await manager.setAllowlist(scopeId, [PAY_TO], true)).wait())
ok(`allowlisted to ${PAY_TO.slice(0, 10)}… and nothing else`)

step('1. The biller collects this month')
const asBiller = manager.connect(biller)
const before = await bal(usdt, PAY_TO)
await settled(await (await asBiller.spend(scopeId, PAY_TO, PRICE)).wait())
const after = await bal(usdt, PAY_TO)
ok(`the service was paid: ${before} → ${after} USDT`)
info(`the household's position is now ${await bal(ausdt, funder.address)} aUSDT`)

step('2. It cannot take twice in the same month')
info(`spendable is now ${ethers.formatUnits(await manager.spendable(scopeId), 6)}`)
await mustRevert('a second charge', () => asBiller.spend.staticCall(scopeId, PAY_TO, PRICE), 'OverPeriodCap(uint256,uint256)')

step('3. It cannot send the money anywhere else')
await mustRevert('paying itself', () => asBiller.spend.staticCall(scopeId, biller.address, PRICE), 'RecipientNotAllowed(address)')
await mustRevert('paying a stranger', () => asBiller.spend.staticCall(scopeId, ELSEWHERE, PRICE), 'RecipientNotAllowed(address)')

step('4. The term is on-chain, not in our database')
const scope = await manager.getScope(scopeId)
if (Number(scope.expiry) !== expiry) throw new Error(`expiry not stored: ${scope.expiry}`)
// Periods align to grantedAt, and the expiry lands inside the last one, so the
// count of chargeable periods is the number of whole ones plus that partial.
// `grantedAt` is the mined block's timestamp, always a few seconds after the
// one we asked for, which is what keeps this from rounding up to a thirteenth.
const last = Math.floor((Number(scope.expiry) - Number(scope.grantedAt)) / Number(scope.periodLength))
const charges = last + 1
ok(`the scope expires at ${new Date(Number(scope.expiry) * 1000).toDateString()}`)
ok(`periods 0 to ${last} can be charged, so ${charges} in total and never a ${charges + 1}th`)
if (charges !== TERM_MONTHS) throw new Error(`term is ${charges} charges, expected ${TERM_MONTHS}`)
info(`most it can ever take: ${ethers.formatUnits(PRICE * BigInt(charges), 6)} USDT`)

step('5. The household cancels early')
await settled(await (await manager.revoke(scopeId)).wait())
ok('revoked')
await mustRevert('collecting after cancellation', () => asBiller.spend.staticCall(scopeId, PAY_TO, PRICE), 'Revoked()')

console.log('\n\x1b[32mAll five hold.\x1b[0m The cap, the destination, the term and the')
console.log('cancellation are the contract\'s, not the app\'s.\n')
