# Kin

A family allowance wallet. One pot of USD₮ that kids spend from directly, inside
limits the parent sets on-chain. Nobody holds a native token or sees a seed
phrase.

Tether WDK Track 2 (gasless), on Base Sepolia.

## The idea

Giving a kid money means choosing between cash, which you cannot see or limit,
and a card, which shows you the damage a day late. Neither lets you say "20 a
week, 5 at a time, and only at these shops" and have it actually hold.

Kin keeps the household money in one pot that earns while it sits, and gives each
kid a spending scope. The limit is not a rule in the app. It is a contract, and
the app cannot lie about it.

## How it works

- **The pot** is the parent's own USD₮ supplied to Aave V3. They keep custody and
  it earns while idle.
- **A scope** per kid: per-purchase cap, weekly cap, optional expiry, optional
  list of addresses they may pay. One grant, enforced on-chain.
- **Joining** is a link. The kid taps it, does Face ID once, and has a working
  account. No install, no funding step, no seed phrase.
- **Paying** redeems out of the parent's Aave position and lands on the merchant
  **in the same transaction**.
- **Over the cap, or off the list**, the payment becomes a request the parent
  approves from their phone. Revoking is instant and on-chain.
- **Gas** is paid by the parent in USD₮, through a paymaster in this repo. Kids
  pay nothing, because a child should not need a balance to spend an allowance.

## Demo

Five beats, live on Base Sepolia. `./server/e2e-demo.sh` runs them headlessly and
prints every hash.

| # | What happens | Receipt |
|---|---|---|
| 1 | Parent puts 500 USD₮ into Aave and holds real `aUSDT` | [funded, approved and supplied in one op](https://sepolia.basescan.org/tx/0xe22505de473bc9148a863b87e9fa09b463fcf4325825af25e788eea86e488eb4) |
| 2 | Kid joins by link with Face ID, holding nothing | the address exists before it ever transacts |
| 3 | Kid spends 8 USD₮, redeemed straight to the merchant, no gas | [one kid-signed op](https://sepolia.basescan.org/tx/0x7d5d535fe2c65576af68f72efe0f8149d22399664c4ad3d169e710f091e80fea) |
| 4 | Kid tries 200, over the cap, so it becomes a request | [the ask](https://sepolia.basescan.org/tx/0xfe6a28b9e9e6aa948629b49bbb67aea2bc91cd033717d663712443a3da1e13ea), [the approval](https://sepolia.basescan.org/tx/0x61376e392b95f3d7ad15ec01e7515e0c1ff2d442cf2b4e91518911bd293349d8) |
| 5 | Parent revokes, next attempt refused by the contract | [the revoke](https://sepolia.basescan.org/tx/0x879df2af6f0b964c22939f23ad93d7e75ac1e9985a4c1d00e976d546042b899c) |

Force beat 5 rather than trusting it: `POST /api/spend` with `{"force": true}`
skips every check in this app, so what comes back is the contract's own
`Revoked()`, not our UI being polite.

## How a payment settles

```
parent ──WDK──▶ [ top up + USD₮.approve(pool) + pool.supply
                  + USD₮.approve(paymaster) ]                    one op

parent ──WDK──▶ [ aUSDT.approve(manager, Σ caps) + manager.grant(kid, …) ]

kid    ──WDK──▶ manager.spend(id, merchant, 8)
                  │ checks caller, per-tx cap, weekly cap, expiry, allowlist
                  ├─▶ aUSDT.transferFrom(parent → manager, 8)
                  └─▶ pool.withdraw(USD₮, 8, merchant)           same tx
```

On testnet the top-up is a faucet call riding in the same batch. On mainnet the
parent already holds USD₮ and it is three calls, not four.

Decoded from a real payment (`node server/verify/decode-spend.mjs <tx>`):

```
aBasSepUSDT   parent  → manager     8.0    the position is pulled
aBasSepUSDT   manager → burned      8.0    Aave redeems it
USD₮          aToken  → merchant    8.0    the merchant is paid
```

**The parent keeps custody.** The pot is their own `aUSDT` in their own account.
The manager holds tokens inside a single `spend` call and never across one.

**The kid signs their own operation.** `sender` is the kid's account. The
contract authorises, not the wallet.

**Approvals stay bounded.** The manager's allowance is the sum of outstanding
weekly caps, recomputed on every grant and revoke. Never `type(uint256).max`.

## Where WDK is used

| WDK surface | File | What it does |
|---|---|---|
| `registerWallet` with `wdk-wallet-evm-7702-gasless` | `server/src/wdk.ts` | Every account is a 7702-delegated EOA; every write is a WDK UserOperation |
| Batched `sendTransaction([...])` | `server/src/routes/parent/` | Multi-step flows land as one op, so a deposit or grant is one signature |
| Kid `sendTransaction` | `server/src/routes/member.ts` | The kid's own account signs its own spend |
| `quoteSendTransaction` | `server/src/wdk.ts` | Prices the exact batch before anything is signed |
| `paymasterUrl` + `paymasterToken`, pinned `paymasterAddress` | `server/src/wdk.ts` | Parent ops priced in USD₮ against our paymaster; WDK throws if the service names a different contract |
| `getUserOperationReceipt` polling | `server/src/wdk.ts` | Receipt-first waiting (note 2) |
| `wdk-secret-manager` | `server/src/vault.ts` | Encrypts wallet entropy at rest, keyed by the WebAuthn PRF output |
| `registerPolicy` | `server/src/wdk.ts` | Locally refuses a kid anything not targeting the manager. Defence in depth; the engine keeps no counters, so the contract is the enforcement |

`@tetherto/wdk` 1.0.0-beta.16 · `wdk-wallet-evm-7702-gasless` 1.0.0-beta.4 ·
`wdk-secret-manager` 1.0.0-beta.3.

Aave and our contracts are plain calldata inside WDK operations. A consumer app,
not an SDK.

## Contracts

| Contract | Address |
|---|---|
| `ScopedSpendManager`, ours | [`0x6c1C15B3…`](https://sepolia.basescan.org/address/0x6c1C15B3c5A77eBA21c3830f0FcD8D2b22635240) |
| `UsdtPaymaster`, ours | [`0x8656b0E5…`](https://sepolia.basescan.org/address/0x8656b0E5CA10a506B42615C78Fa8F137F7f1Ea7B) |
| `Simple7702Account` delegate, eth-infinitism v0.8 | [`0xd066936D…`](https://sepolia.basescan.org/address/0xd066936D3BbBa7E266572143bd30a9c7894A9EDb) |
| EntryPoint v0.8 | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` |
| Aave V3 Pool | `0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27` |
| USD₮ | `0x0a215D8ba66387DCA84B284D18c3B4ec3de6E54a` |
| `aBasSepUSDT` | `0xcE3CAae5Ed17A7AafCEEbc897DE843fA6CC0c018` |

Aave addresses come from `@bgd-labs/aave-address-book` on both the JS and
Solidity side. No hex is pasted anywhere, including from here.

`ScopedSpendManager` knows nothing about families. Its vocabulary is
`funder`/`spender` and `asset`/`source`, so team budgets and agent spend caps are
the same object. When `source == asset` it settles as a plain ERC-20 pull, so the
app also works with no savings position at all.

28 Foundry tests: 19 on the manager, covering every named revert by name, both
settlement paths, weekly roll-over and `spendable()`; 9 on the paymaster.

## Gas paid in USD₮

No provider offers a USD₮ gas token on Base Sepolia. Pimlico lists USDC, EURC,
LINK, PIM; Candide lists CTT. The one testnet USD₮ either accepts is on Ethereum
Sepolia, owner-only-mint with an EOA owner, so no entrant can get any.
`paymaster/verify/why-not-sepolia.mjs` shows the quote failing at the balance
check.

So the paymaster is ours: [`UsdtPaymaster.sol`](paymaster/src/UsdtPaymaster.sol)
plus a fifty-line [ERC-7677 service](server/src/paymaster-service.ts) that
`paymasterUrl` points at. Authorisation is the account's USD₮ approval, not a
signed voucher, so the service holds no key and keeps no state. Validation
reserves 120% of the estimate; `postOp` charges the actual cost.

| Operation | Paymaster | Sender charged |
|---|---|---|
| Parent's first deposit | Pimlico, sponsored | nothing, no USD₮ yet |
| Parent grants an allowance | ours | 0.004770 USD₮ |
| Kid's payment | Pimlico, sponsored | nothing |
| Parent revokes | ours | 0.002011 USD₮ |

`POST /api/quote` runs WDK's `quoteSendTransaction` against the exact batch, so
the fee on screen is a real quote. It says "up to" because a quote is a ceiling
and `postOp` charges less. A grant quoted at 0.012832 settled at 0.005075.

You cannot pay a USD₮ fee before holding USD₮, so funding happens once at sign-up
in one sponsored operation. After that everything is self-paid, re-derived from
chain state each time, so a drained buffer falls back to sponsorship instead of
failing.

The allowance is priced, not guessed: a representative operation at the live gas
price, converted at the paymaster's rate, keeping 250 operations of head-room.

```
live maxFeePerGas :  11000000 wei
fee per operation :  0.01925 USD₮
allowance target  :  4.8125  USD₮
```

The rate is a fixed 1 native = 2500 USD₮ set at deploy, not an oracle, because on
a testnet an oracle quotes fiction.

## Security

**Every write re-authorises, not every session.** Reads use a session cookie.
Writes carry key material at the moment they happen, either a passkey's PRF
output or a passphrase. The server opens the vault, signs, and disposes of the
account in a `finally` block, so the window in which this process can sign
anything is one request long.

A stolen session cookie can read a household's state and cannot move a cent. The
same cookie that returns `/api/state` gets `needsAuth` back from `/api/deposit`.

**The surfaces are asymmetric, server-side.** A kid is never told the size of the
pot or anything about anyone else. `GET /api/me` returns their own limit, whether
this payment clears, and their own payments. `/api/state` refuses them outright.

**Keys sit apart from data.** Family records go to MongoDB when `MONGODB_URI` is
set, to `data/families/` otherwise. Encrypted entropy always goes to
`data/vaults/`, one file per account, directory `0700` and files `0600`. A vault
holds ciphertext, a public salt, and routing. Nothing in it can produce the key.
Sessions hold identity and no key.

**Passkey-gated, not passkey-native.** The on-chain signer is secp256k1, WDK's
seed-derived key. No P-256 verification on-chain and no EIP-7212, so calling this
passkey-native would describe a feature that is not here.

```
WebAuthn PRF → 32 bytes → Secret Manager master-key mode → encrypts BIP-39 entropy
```

Face ID re-derives that key at every unlock; only ciphertext and salt persist.
Authenticators without PRF fall back to a PBKDF2 passphrase (100k, SHA-256). Both
paths are tested. Invite links carry a one-time token and no key material.

WDK runs in a Node worker and the browser does WebAuthn and UI only. That is
forced: `wdk-secret-manager` needs native modules that cannot be bundled for a
browser (note 3).

## Why Base Sepolia

The product needs a real Aave position in USD₮, and one testnet provides it.

On Ethereum Sepolia the USDT reserve sits about 2x over its supply cap, so
`supply()` reverts with `SUPPLY_CAP_EXCEEDED` at any amount. USDC and DAI are the
same, GHO's bucket is full, and the faucet only mints underlyings, so an aToken
cannot be had another way. Base Sepolia's USDT reserve is uncapped, liquid, and
mintable from an open faucet. Check both with
`node server/verify/aave-reserves.mjs`.

Morpho was rejected on evidence: Morpho Blue's core is on both testnets but the
MetaMorpho vault factory is not, and its API indexes mainnets only, so there is
no vault to deposit into. WDK also ships no Morpho module.

The parent's screen shows the position ticking between reads, using the pool's
own `getReserveNormalizedIncome`. The rate is a testnet rate and means nothing.
It is there because a savings balance that never moves looks broken.

## Notes

Five things that cost real time and are in no doc.

1. **`wdk-protocol-lending-aave-evm` cannot be used here** (beta.5). Its chain map
   is mainnets only, and `supply()` requires
   `instanceof WalletAccountEvm || WalletAccountEvmErc4337`, which the 7702
   gasless account is neither. So the Aave leg is direct pool calldata inside
   WDK-batched operations.
2. **Pimlico's `eth_getUserOperationByHash` lags**, returning `null` for
   operations already on-chain. WDK's `waitForTransaction` polls it first, so ops
   looked stuck for ten minutes. Polling `eth_getUserOperationReceipt` instead
   confirms in about 17 seconds.
3. **`wdk-secret-manager` needs a shim under Node.** It requires `bare-crypto`,
   whose binding only loads inside the Bare runtime, and uses one function from
   it. We alias the module to `node:crypto` post-install. Also
   `generateAndEncrypt` is async despite a synchronous signature in the shipped
   `.d.ts`. Await it.
4. **The Aave faucet has a per-address mint timelock.** One mint per day whatever
   the size. Minting inside the deposit flow worked exactly once; the second
   deposit of the day reverted with `Mint timelock exceeded`, and since a fee
   quote simulates the real batch, the quote failed with it. Funding now happens
   once at onboarding.
5. **A self-hosted paymaster needs two undocumented things.** It must be *staked*
   with the EntryPoint, because reading the sender's balance and allowance is
   external-storage access that ERC-7562 only allows a staked paymaster. And its
   ERC-7677 stub must not set `isFinal: true`: the client's order is stub,
   estimate, `pm_getPaymasterData`, and the estimate overwrites
   `paymasterPostOpGasLimit` with the bundler's guess (3,775, against the ~25k a
   `transferFrom` needs). Only the final call restores it. A stub marked final
   short-circuits, and every op reverts with `PostOpReverted` and empty revert
   data, which is what out-of-gas in `postOp` looks like.

## Layout

```
contracts/   ScopedSpendManager, the allowance rules
paymaster/   UsdtPaymaster, gas paid in USD₮
server/      the API, the WDK integration, the ERC-7677 service
web/         the phone app
```

Two contracts, two problems: one bounds what a kid may spend, the other lets an
account pay for its own transaction without a native coin. Each directory carries
the scripts that prove its own claims, under `verify/`.

## Run it

Node 22.18+, [bun](https://bun.sh). Foundry only for contract work, cloudflared
only to reach it from a phone.

```bash
git clone <this repo> && cd kin
cp .env.example .env        # fill in the values marked "you provide"
bun install && (cd server && bun install) && (cd web && bun install)
(cd web && bun run build)   # the server serves web/dist
(cd server && bun run start)

# Face ID needs HTTPS, and a tunnel is the easiest way:
cloudflared tunnel --url http://localhost:8787
```

Open the URL, start a family, follow the two-step setup. Passkeys are tied to a
browser profile, so open a kid's invite link in a second browser or a private
window, or their Face ID unlocks the parent's account.

`MONGODB_URI` is optional. Without it the server writes JSON under `server/data/`.

```bash
cd contracts && forge test                    # 19 tests, the manager
cd paymaster && forge test                    # 9 tests, the paymaster
cd server && bun run test                     # the vault, PRF and passphrase
cd web && bun run test                        # 47 tests, money and UI logic

node server/verify/sponsored-op.mjs           # sponsored op from an empty EOA
node server/verify/aave-roundtrip.mjs         # gasless Aave deposit and withdraw
node server/verify/aave-reserves.mjs          # the supply-cap evidence above
node server/verify/decode-spend.mjs <tx>      # decode a payment's settlement
node paymaster/verify/why-not-sepolia.mjs     # why Sepolia's USD₮ is unusable
node paymaster/verify/pay-gas-in-usdt.mjs     # gas in USD₮, no native coin held
node paymaster/verify/decode-fee.mjs <tx>     # decode who paid for an operation
```

To redeploy:

```bash
(cd contracts && forge script script/DeployBase.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast)
(cd paymaster && forge script script/Deploy.s.sol     --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast)
```

The paymaster deploy also funds its EntryPoint deposit and stakes it. Without the
stake, bundlers reject every operation (note 5).

## Reuse disclosure

The author works on JAW, a passkey-native smart-account SDK with an on-chain
permission manager, and `ScopedSpendManager` is conceptually adjacent to it. The
contract here was written from scratch this weekend with no code imported, the
delegate is eth-infinitism's `Simple7702Account` rather than a JAW account, and
every WDK integration in this repo is new.

## Non-goals

Multi-chain, recurring billing, cross-chain anything, custodial backends,
recovery beyond the encrypted-blob restore, general-purpose SDKs. One chain, one
protocol, two screens, five beats.
