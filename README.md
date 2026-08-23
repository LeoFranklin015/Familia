# Familia

One wallet for everything a household pays for: the kids' pocket money, the
shopping, and the monthly bills, out of a single pot of USD₮ that earns in Aave
while it sits. Every limit is enforced by a contract, not by the app. Nobody
holds a native token or sees a seed phrase.

Tether WDK Track 2 (gasless), on Base Sepolia.

- **Pocket money.** Each kid gets a scope: per-purchase cap, weekly cap,
  optional expiry, optional list of addresses they may pay. Joining is a link:
  tap, Face ID once, done. Paying redeems from Aave straight to the shop in one
  transaction. Over the cap or off the list, it becomes a request the parent
  approves from their phone.
- **The household's own payments.** The parent pays anyone from the pot.
- **Subscriptions.** Netflix and the rest are the same scope with a biller as
  the spender: one month's price per period, only to the service's own address,
  for twelve months, cancellable instantly.
- **Fees.** The parent pays in USD₮ through a paymaster in this repo. Kids pay
  nothing. Billers pay their own gas.

## Demo

Live on Base Sepolia. `./server/e2e-demo.sh` runs beats 1–5 headlessly against a
running server and prints every hash; `node server/verify/subscription.mjs` does
beat 6 against the deployed contract.

| # | What happens | Receipt |
|---|---|---|
| 1 | Parent puts 500 USD₮ into Aave and holds real `aUSDT` | [funded, approved and supplied in one op](https://sepolia.basescan.org/tx/0xe22505de473bc9148a863b87e9fa09b463fcf4325825af25e788eea86e488eb4) |
| 2 | Kid joins by link with Face ID, holding nothing | the address exists before it ever transacts |
| 3 | Kid spends 8 USD₮, redeemed straight to the merchant, no gas | [one kid-signed op](https://sepolia.basescan.org/tx/0x7d5d535fe2c65576af68f72efe0f8149d22399664c4ad3d169e710f091e80fea) |
| 4 | Kid tries 200, over the cap, so it becomes a request | [the ask](https://sepolia.basescan.org/tx/0xfe6a28b9e9e6aa948629b49bbb67aea2bc91cd033717d663712443a3da1e13ea), [the approval](https://sepolia.basescan.org/tx/0x61376e392b95f3d7ad15ec01e7515e0c1ff2d442cf2b4e91518911bd293349d8) |
| 5 | Parent revokes, next attempt refused by the contract | [the revoke](https://sepolia.basescan.org/tx/0x879df2af6f0b964c22939f23ad93d7e75ac1e9985a4c1d00e976d546042b899c) |
| 6 | Netflix gets a mandate, collects once, is then refused | [mandate](https://sepolia.basescan.org/tx/0x8a0c267716eb8006ede94967c02ebdc593e20f76c51b894b525be72a5e6c6364), [collection](https://sepolia.basescan.org/tx/0xc068e223dac75d695d6ecfb4dab2a710a0da4c9123f5bce1bcfa77a94a1806cd), [cancellation](https://sepolia.basescan.org/tx/0x028bebd269bb0c2a5eb2b9fd1ab3577e0794a59464999025120855d68d84c102) |

Force beat 5 rather than trusting it: `POST /api/spend` with `{"force": true}`
skips every check in this app, so what comes back is the contract's own
`Revoked()`, not our UI being polite.

Other scripts, each proving one claim:

```bash
node server/verify/sponsored-op.mjs           # sponsored op from an empty EOA
node server/verify/aave-roundtrip.mjs         # gasless Aave deposit and withdraw
node server/verify/aave-reserves.mjs          # why not Ethereum Sepolia
node server/verify/decode-spend.mjs <tx>      # decode a payment's settlement
node paymaster/verify/pay-gas-in-usdt.mjs     # gas in USD₮, no native coin held
node paymaster/verify/decode-fee.mjs <tx>     # decode who paid for an operation
```

## Where WDK is used

| Surface | File | What it does |
|---|---|---|
| `registerWallet` + `wdk-wallet-evm-7702-gasless` | `server/src/wdk.ts` | Every account is a 7702-delegated EOA; every write is a WDK UserOperation |
| Batched `sendTransaction([...])` | `server/src/routes/parent/` | Multi-step flows land as one op, so a deposit or grant is one signature |
| Kid `sendTransaction` | `server/src/routes/member.ts` | The kid's own account signs its own spend |
| `quoteSendTransaction` | `server/src/wdk.ts` | Prices the exact batch before anything is signed |
| `paymasterUrl` + `paymasterToken`, pinned address | `server/src/wdk.ts` | Parent ops priced in USD₮ against our paymaster |
| `getUserOperationReceipt` polling | `server/src/wdk.ts` | Receipt-first waiting; Pimlico's `…ByHash` returns null for ops already on-chain |
| `wdk-secret-manager` | `server/src/vault.ts` | Encrypts wallet entropy, keyed by the WebAuthn PRF output |
| `registerPolicy` | `server/src/wdk.ts` | Refuses a kid anything not targeting the manager. Defence in depth; the contract is the enforcement |

`@tetherto/wdk` 1.0.0-beta.16 · `wdk-wallet-evm-7702-gasless` 1.0.0-beta.4 ·
`wdk-secret-manager` 1.0.0-beta.3.

One path deliberately skips WDK: a biller collecting a subscription signs with
its own key, because it is not the household's account.

## Contracts

| Contract | Address |
|---|---|
| `ScopedSpendManager`, ours | [`0x6c1C15B3…`](https://sepolia.basescan.org/address/0x6c1C15B3c5A77eBA21c3830f0FcD8D2b22635240) |
| `UsdtPaymaster`, ours | [`0x8656b0E5…`](https://sepolia.basescan.org/address/0x8656b0E5CA10a506B42615C78Fa8F137F7f1Ea7B) |
| `Simple7702Account`, eth-infinitism v0.8 | [`0xd066936D…`](https://sepolia.basescan.org/address/0xd066936D3BbBa7E266572143bd30a9c7894A9EDb) |
| EntryPoint v0.8 | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` |
| Aave V3 Pool | `0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27` |
| USD₮ | `0x0a215D8ba66387DCA84B284D18c3B4ec3de6E54a` |
| `aBasSepUSDT` | `0xcE3CAae5Ed17A7AafCEEbc897DE843fA6CC0c018` |

Aave addresses come from `@bgd-labs/aave-address-book` on both the JS and
Solidity side. No hex is pasted anywhere, including from here.

A kid's spend redeems the parent's `aUSDT` and pays the merchant in the same
transaction:

```
kid ──WDK──▶ manager.spend(id, merchant, 8)
               │ checks caller, per-tx cap, weekly cap, expiry, allowlist
               ├─▶ aUSDT.transferFrom(parent → manager, 8)
               └─▶ pool.withdraw(USD₮, 8, merchant)
```

The parent keeps custody throughout, since the manager holds tokens inside a
single `spend` call and never across one. Its allowance is the sum of every live
scope's period cap, recomputed on each grant and revoke. Never
`type(uint256).max`.

`ScopedSpendManager` knows nothing about families: its vocabulary is
`funder`/`spender` and `asset`/`source`, which is why subscriptions needed no
new contract. When `source == asset` it settles as a plain ERC-20 pull, so the
app works with no savings position at all.

## Gas in USD₮

No provider offers a USD₮ gas token on Base Sepolia. Pimlico lists USDC, EURC,
LINK, PIM; Candide lists CTT. The one testnet USD₮ either accepts is on Ethereum
Sepolia, owner-only-mint with an EOA owner, so no entrant can obtain any
(`paymaster/verify/why-not-sepolia.mjs` shows the quote failing at the balance
check). So the paymaster is ours, with an ERC-7677 service in front of it that
holds no key and no state: authorisation is the account's USD₮ approval, not a
signed voucher.

| Operation | Paymaster | Sender charged |
|---|---|---|
| Parent's first deposit | Pimlico, sponsored | nothing, no USD₮ yet |
| Parent grants an allowance | ours | 0.004770 USD₮ |
| Kid's payment | Pimlico, sponsored | nothing |
| Parent revokes | ours | 0.002011 USD₮ |

`POST /api/quote` prices the exact batch, so the fee shown before signing is a
real quote. It says "up to" because `postOp` charges the actual cost: a grant
quoted at 0.012832 settled at 0.005075. The rate is a fixed
1 native = 2500 USD₮ set at deploy, not an oracle, because on a testnet an
oracle quotes fiction.

## Run it

Needs Node 22.18+, [bun](https://bun.sh), and Foundry if you want to redeploy
the contracts.

```bash
git clone <this repo> && cd familia
cp .env.example .env
bun install && (cd server && bun install) && (cd web && bun install)
(cd web && bun run build)     # the server serves web/dist
(cd server && bun run start)  # http://localhost:8787
```

Face ID needs HTTPS, so to use it from a phone:

```bash
cloudflared tunnel --url http://localhost:8787
```

Open the URL, start a family, follow the two-step setup. Passkeys are tied to a
browser profile, so open a kid's invite link in a second browser or a private
window.

### Environment

Only the first three are needed to run against the already-deployed contracts.

| Variable | |
|---|---|
| `PIMLICO_API_KEY` | dashboard.pimlico.io. Leave the sponsorship policy unrestricted, because member addresses do not exist yet |
| `BASE_SEPOLIA_RPC_URL` | Alchemy/Infura/dRPC. `https://sepolia.base.org` works but rate-limits under load |
| `DEPLOYER_PRIVATE_KEY` | Test key with a little Base Sepolia ETH. Deploys the contracts and, by default, collects subscriptions |
| `BILLER_PRIVATE_KEY` | Optional. The subscription collector, if you want it separate from the deployer |
| `MONGODB_URI` | Optional. Unset falls back to JSON files under `server/data/` |
| `POLICY_ID` | Optional Pimlico sponsorship policy id |
| `SEPOLIA_RPC_URL` | Only for the two scripts that document why the app is not on Ethereum Sepolia |

`DELEGATION_ADDRESS`, `SCOPED_SPEND_MANAGER_ADDRESS` and
`USDT_PAYMASTER_ADDRESS` are pre-filled in `.env.example` with the live
deployments below.

### Redeploying the contracts

```bash
(cd contracts && forge script script/DeployBase.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast)
(cd paymaster && forge script script/Deploy.s.sol     --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast)
```

Put the two addresses in `.env`. The paymaster script also funds its EntryPoint
deposit and **stakes** it. Without the stake, bundlers reject every operation,
because reading the sender's token balance during validation is external-storage
access that ERC-7562 only permits a staked paymaster.

### Tests

```bash
cd contracts && forge test     # 19  the spend manager
cd paymaster && forge test     #  9  the paymaster
cd server    && bun run test   #  4  the vault, PRF and passphrase
cd web       && bun run test   # 52  money, addresses, time, accrual
```

## Limits and disclosure

Not built: multi-chain, cross-chain anything, custodial backends, recovery
beyond the encrypted-blob restore, a real biller network. Services are a fixed
catalogue with test payout addresses, and collection is triggered by hand rather
than a scheduler. The sign-in throttle is in memory, and PBKDF2 at 100k is
adequate for a testnet passphrase and not for real money. This is
passkey-*gated*, not passkey-native: the on-chain signer is secp256k1, and Face
ID derives the key that decrypts it.

The author works on JAW, a passkey-native smart-account SDK with an on-chain
permission manager, and `ScopedSpendManager` is conceptually adjacent. The
contract here was written from scratch this weekend with no code imported, the
delegate is eth-infinitism's `Simple7702Account`, and every WDK integration in
this repo is new.
