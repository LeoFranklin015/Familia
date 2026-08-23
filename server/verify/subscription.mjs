// A recurring mandate, end to end, against the deployed manager.
//
// Proves the four claims the subscriptions screen makes:
//
//   1. a biller can take one month's price, and the money lands on the
//      service's payout address, not the biller's
//   2. a second attempt inside the same period is refused on-chain
//   3. the biller cannot redirect the money somewhere else
//   4. the household can revoke, and the biller is refused from then on
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
const PAY_TO = '0x4444000000000000000000000000000000004444' // the service's payout address
const ELSEWHERE = '0x9999000000000000000000000000000000009999'

const erc20 = new ethers.Interface([
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
])
const manager = new ethers.Contract(MANAGER, [
  'function grant(address,address,address,uint256,uint256,uint256,uint256) returns (bytes32)',
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

/** Run a call that must revert, and name the error it reverted with. */
async function mustRevert(label, fn, expected) {
  try {
    await (await fn()).wait()
    throw new Error(`${label}: it went through, and it should not have`)
  } catch (e) {
    const data = (JSON.stringify(e).match(/0x[0-9a-fA-F]{8,}/g) ?? []).join('')
    const selector = ethers.id(expected).slice(2, 10)
    if (!data.includes(selector)) throw new Error(`${label}: expected ${expected}, got ${e.shortMessage ?? e.message}`)
    ok(`${label} — refused with ${expected}`)
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
const granted = await (await manager.grant(biller.address, USDT, AUSDT, PRICE, PRICE, MONTH, 0)).wait()
const scopeId = manager.interface.parseLog(
  granted.logs.find((l) => l.address.toLowerCase() === MANAGER.toLowerCase()),
).args.id
ok(`scope ${scopeId.slice(0, 18)}…`)
info(`capped at ${ethers.formatUnits(PRICE, 6)} per charge and per month`)

await (await manager.setAllowlist(scopeId, [PAY_TO], true)).wait()
ok(`allowlisted to ${PAY_TO.slice(0, 10)}… and nothing else`)

step('1. The biller collects this month')
const asBiller = manager.connect(biller)
const before = await bal(usdt, PAY_TO)
await (await asBiller.spend(scopeId, PAY_TO, PRICE)).wait()
const after = await bal(usdt, PAY_TO)
ok(`the service was paid: ${before} → ${after} USDT`)
info(`the household's position is now ${await bal(ausdt, funder.address)} aUSDT`)

step('2. It cannot take twice in the same month')
info(`spendable is now ${ethers.formatUnits(await manager.spendable(scopeId), 6)}`)
await mustRevert('a second charge', () => asBiller.spend(scopeId, PAY_TO, PRICE), 'OverPeriodCap(uint256,uint256)')

step('3. It cannot send the money anywhere else')
await mustRevert('paying itself', () => asBiller.spend(scopeId, biller.address, PRICE), 'RecipientNotAllowed(address)')
await mustRevert('paying a stranger', () => asBiller.spend(scopeId, ELSEWHERE, PRICE), 'RecipientNotAllowed(address)')

step('4. The household cancels')
await (await manager.revoke(scopeId)).wait()
ok('revoked')
await mustRevert('collecting after cancellation', () => asBiller.spend(scopeId, PAY_TO, PRICE), 'Revoked()')

console.log('\n\x1b[32mAll four hold.\x1b[0m The cap, the destination and the cancellation are')
console.log('the contract\'s, not the app\'s.\n')
