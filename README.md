# Kin — a family allowance wallet, gasless on WDK

**Tether WDK Track 2 (gasless) · Base Sepolia · EIP-7702 + ERC-4337 · Aave V3**

One household pot of **USD₮** that family members spend from directly, within
limits the guardian sets **on-chain** — without ever holding a native token or
seeing a seed phrase.

The parent funds the pot and supplies it to **Aave V3**, ending up with real
`aUSDT` — faucet mint, approve and supply in **one** UserOperation, from an
account that begins with nothing at all, not even gas. They send an invite
link. A member taps it, does Face ID once, and has a working account: no app
install, no funding step, no seed phrase shown. The parent grants each member a
scope — per-purchase cap, per-week cap, optional expiry and recipient allowlist
— enforced by a small contract. Members spend against that scope, and the money
is redeemed out of the parent's Aave position and paid to the merchant **in the
same transaction**. Over the cap, a spend doesn't fail — it becomes an on-chain
request the parent approves from their phone. Revocation is instant and
on-chain.

**Fees.** The parent pays their own, in **USD₮**, through a paymaster in this
repo. Members pay nothing at all — their operations are sponsored, because a
child should not need a balance of anything to spend an allowance. Nobody
touches a native token at any point.

## The five demo beats

All verified on Base Sepolia. Run them yourself against a live server with
`./scripts/e2e-demo.sh`.

| # | Beat | Proof |
|---|---|---|
| 1 | Parent deposits 500 USD₮ into Aave and holds real `aUSDT` | [faucet mint + approve + supply, one op](https://sepolia.basescan.org/tx/0xe22505de473bc9148a863b87e9fa09b463fcf4325825af25e788eea86e488eb4) |
| 2 | Member joins by link, Face ID, zero balance of anything | the address exists before it ever transacts — under EIP-7702 it is still a plain EOA |
| 3 | Member spends 8 USD₮: `aUSDT` redeemed → merchant paid, no gas | [one member-signed op](https://sepolia.basescan.org/tx/0x7d5d535fe2c65576af68f72efe0f8149d22399664c4ad3d169e710f091e80fea) |
| 4 | Member tries 200 (over cap) → becomes an ask → parent approves → clears | [the ask](https://sepolia.basescan.org/tx/0xfe6a28b9e9e6aa948629b49bbb67aea2bc91cd033717d663712443a3da1e13ea) · [the approval](https://sepolia.basescan.org/tx/0x61376e392b95f3d7ad15ec01e7515e0c1ff2d442cf2b4e91518911bd293349d8) |
| 5 | Parent revokes → the next attempt is refused by the contract | [the revoke](https://sepolia.basescan.org/tx/0x879df2af6f0b964c22939f23ad93d7e75ac1e9985a4c1d00e976d546042b899c); a forced retry returns the manager's `Revoked()` |

Beat 5 is worth forcing rather than trusting: `POST /api/spend` with
`{"force": true}` skips every check in this app and sends the operation
anyway, so the refusal you see is the contract's own `Revoked()` error decoded
— not our UI being polite.

## Where WDK is used (the integration, exactly)

| WDK surface | File / line | What it does here |
|---|---|---|
| `new WDK(seed).registerWallet(...)` + `wdk-wallet-evm-7702-gasless` | [`server/src/wdk.ts` L27](server/src/wdk.ts#L27) | Every account — parent and members — is a 7702-delegated EOA, and every write is an ERC-4337 UserOperation built and signed by WDK |
| Batched `sendTransaction([...])` | [`parent.ts` L64](server/src/routes/parent.ts#L64) (mint + approve + Aave supply + paymaster approval), [L92](server/src/routes/parent.ts#L92) (bounded `aUSDT` approve + grant), [L120](server/src/routes/parent.ts#L120) (revoke + allowance reset), [L151](server/src/routes/parent.ts#L151) (allowance head-room + `approveRequest` + reset, atomic) | Multi-step flows land as **one** UserOperation, so a deposit or a grant is a single signature and a single receipt |
| Member `sendTransaction` | [`member.ts` L84](server/src/routes/member.ts#L84) (spend), [L104](server/src/routes/member.ts#L104) (requestSpend) | The member's own account signs; `sender` is the member's own EOA. Authorisation is the contract's job, not the wallet's |
| Second registration for token fees: `paymasterUrl` + `paymasterToken` + pinned `paymasterAddress` | [`server/src/wdk.ts` L76](server/src/wdk.ts#L76), chosen per operation at [`parent.ts` L37](server/src/routes/parent.ts#L37) | The parent's operations are priced in USD₮ against our own paymaster; members stay sponsored. `paymasterAddress` is pinned so WDK throws if the service ever names a different contract |
| `getUserOperationReceipt` polling | [`server/src/wdk.ts` L111](server/src/wdk.ts#L111) | Receipt-first waiting — see field note 2 for why `waitForTransaction` could not be used |
| `@tetherto/wdk-secret-manager` | [`server/src/vault.ts` L40](server/src/vault.ts#L40) | Encrypts wallet entropy at rest. Master-key mode takes the WebAuthn PRF output; a PBKDF2 passphrase is the fallback |
| WDK policy engine `registerPolicy` | [`server/src/wdk.ts` L39](server/src/wdk.ts#L39) | A member's session account is locally refused any transaction that doesn't target the spend manager. Defence in depth only: the engine keeps no counters, so it cannot express "120 per week" by itself. **The contract is the enforcement.** |

WDK packages, installed versions:

| Package | Version |
|---|---|
| `@tetherto/wdk` | 1.0.0-beta.16 |
| `@tetherto/wdk-wallet-evm-7702-gasless` | 1.0.0-beta.4 |
| `@tetherto/wdk-secret-manager` | 1.0.0-beta.3 |

**Integration boundary.** WDK's gasless module is the execution layer for
everything: deposits, grants, spends, approvals and revocations are all
WDK-built UserOperations. Aave and our two contracts are called as plain
calldata inside those operations. This is a consumer app, not an SDK.

## Architecture

```
parent ──WDK 7702──▶ [ faucet.mint(USD₮) + USD₮.approve(POOL) + POOL.supply
                       + USD₮.approve(paymaster, fee buffer) ]      one op
                        └─▶ Aave mints the parent aUSDT

parent ──WDK 7702──▶ [ aUSDT.approve(manager, Σ caps) + manager.grant(member, …) ]

member ──WDK 7702──▶ manager.spend(id, merchant, 8)
                       │ checks caller, per-tx cap, period cap, expiry, allowlist
                       ├─▶ aUSDT.transferFrom(parent → manager, 8)
                       └─▶ POOL.withdraw(USD₮, 8, merchant)         same tx
```

Decoded from a real payment — `node spikes/verify-spend.mjs <txHash>`:

```
aBasSepUSDT   parent  → manager     8.0    the position is pulled
aBasSepUSDT   manager → burned      8.0    Aave redeems it
USD₮          aToken  → merchant    8.0    the merchant is paid
```

Three properties that hold throughout:

- **The parent keeps custody.** The pot is the parent's own `aUSDT`, in the
  parent's own account. The manager holds tokens only inside a single `spend`
  call and never across one.
- **The member's UserOperation has `sender` = the member's own account**, signed
  by the member's own key. The manager does the authorising.
- **Bounded approvals, always.** The manager's allowance is the sum of
  outstanding period caps, recomputed on every grant and revoke — never
  `type(uint256).max`. Approving an over-cap request raises the allowance by
  exactly that amount, settles, and puts it back, all in one atomic operation.

### Contracts (Base Sepolia)

| Contract | Address |
|---|---|
| `ScopedSpendManager` — ours, written this weekend | [`0x6c1C15B3…`](https://sepolia.basescan.org/address/0x6c1C15B3c5A77eBA21c3830f0FcD8D2b22635240) |
| `UsdtPaymaster` — ours; charges gas in USD₮ | [`0x8656b0E5…`](https://sepolia.basescan.org/address/0x8656b0E5CA10a506B42615C78Fa8F137F7f1Ea7B) |
| `Simple7702Account` delegate — eth-infinitism v0.8, deployed by us | [`0xd066936D…`](https://sepolia.basescan.org/address/0xd066936D3BbBa7E266572143bd30a9c7894A9EDb) |
| EntryPoint v0.8 | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` |
| Aave V3 POOL | `0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27` |
| USD₮ — the family money | `0x0a215D8ba66387DCA84B284D18c3B4ec3de6E54a` |
| `aBasSepUSDT` — Aave's own aToken | `0xcE3CAae5Ed17A7AafCEEbc897DE843fA6CC0c018` |
| Aave testnet faucet — unpermissioned | `0xD9145b5F45Ad4519c7ACcD6E0A4A82e83bB8A6Dc` |

Every Aave address is imported from `@bgd-labs/aave-address-book`, on both the
JavaScript and Solidity sides. No hex is pasted anywhere, including from this
README.

`ScopedSpendManager` is deliberately generic — its vocabulary is
`funder`/`spender` and `asset`/`source`, with no notion of a family. Household
allowances, team budgets, agent spend caps and subscription mandates are the
same object; the family framing lives only in the product layer. When
`source == asset` it settles as a plain ERC-20 pull, so the app also works with
no savings position at all.

**28 Foundry tests** (`cd contracts && forge test`): 19 on the manager, covering
every named revert by name — `NotSpender`, `NotFunder`, `Revoked`, `Expired`,
`OverPerTxCap`, `OverPeriodCap`, `RecipientNotAllowed`, `RequestExpired`,
`UnknownId`, `TransferFailed`, `PoolNotSet` — plus both settlement paths,
period roll-over, and `spendable()` telling the truth against caps, balance and
allowance at once. 9 on the paymaster.

### Paying gas in USD₮ — with our own paymaster

Track 2 asks for USD₮ as the gas token, and **no provider offers one on Base
Sepolia**: Pimlico's list there is USDC/EURC/LINK/PIM, Candide's is CTT alone.
The one testnet USD₮ either accepts is on Ethereum Sepolia (`0xd077A4…`), and
it is owner-only-mint with an **EOA** owner — so no entrant can obtain any. A
fee quote against it fails at the balance check before a payment is even
attempted (`spikes/spike2-usdt-fee-quote.mjs` demonstrates exactly that).

So the paymaster is ours: [`UsdtPaymaster.sol`](contracts/src/UsdtPaymaster.sol)
with a small [ERC-7677 service](server/src/paymaster-service.ts) in front that
WDK's `paymasterUrl` points at. It is permissionless — authorisation is the
account's USD₮ approval, not a signed voucher — which is why the service holds
no key and keeps no state. Validation reserves 120% of the estimate; `postOp`
charges the **actual** cost. End to end in
`spikes/spike3-own-usdt-paymaster.mjs`, from an account that never holds a wei.

Who paid for what, decoded from the run linked above
(`node spikes/verify-fees.mjs <txHash>`):

| Operation | Paymaster | Sender charged |
|---|---|---|
| Parent's first deposit | Pimlico, sponsored | nothing — no USD₮ exists yet to pay with |
| Parent grants an allowance | **ours** | 0.004770 USD₮ |
| **Member's payment** | Pimlico, sponsored | **nothing** |
| Parent revokes | **ours** | 0.002011 USD₮ |

The UI shows this before anything is signed. `POST /api/quote` runs WDK's own
`quoteSendTransaction` against the **exact batch** the action would send, so
the figure on screen is a real quote rather than a guess, and the parent's
screen reads *"Network fee up to 0.0128 USD₮ — charged in USD₮, not ETH."*
"Up to" is deliberate: a quote is a ceiling (max gas at max fee) while the
paymaster charges the actual cost in `postOp`, so the real figure is lower and
gets reported back after signing — a grant quoted at 0.012832 settled at
0.005075. Before the first deposit the same endpoint honestly answers
"sponsored, nothing", because there is no USD₮ to pay with yet.

The bootstrap is the only subtle part: you cannot pay a USD₮ fee before holding
USD₮. So funding happens **once, during onboarding** — the parent's sign-up
fires one sponsored operation that draws test USD₮ from the faucet and sets the
paymaster's allowance. It runs in the background, so signing up is still two
taps, and the Pot tab reports it. Everything after that is self-paid, and the
choice is re-derived from on-chain state each time, so a drained buffer
degrades to sponsorship rather than failing.

Keeping the faucet out of the deposit path is not incidental: it enforces a
per-address mint timelock, so minting per deposit works exactly once and then
fails for the rest of the day (field note 5).

**The allowance is priced, not guessed.** A real ERC-20 paymaster integration
has to answer "how much of my token may this contract take?", and the honest
answer moves with gas. We price a representative operation at the current fee,
convert it through the paymaster's own rate, and keep 250 operations of
head-room — topping it back up automatically once it's down to twenty. At the
time of writing that reads:

```
live maxFeePerGas :  11000000 wei
fee per operation :  0.01925 USD₮      ← derived from that gas price
allowance target  :  4.8125  USD₮      ← 250 operations of head-room
```

If gas gets ten times more expensive both numbers scale with it. Nothing in
that path is a constant.

Two things stated plainly rather than left to be discovered. The rate is a
fixed `1 native = 2500 USD₮` set at deploy, not an oracle — on a testnet an
oracle quotes fiction, and on a live network this contract should read a real
feed. And this is **our** paymaster, not a provider's, which is the only way to
price gas in USD₮ on this chain at all.

### Who sees what

The two surfaces are deliberately asymmetric, and the asymmetry is enforced
server-side, not by hiding UI:

- **The parent** sees the pot, the USD₮ they hold for fees, what is committed to
  each person in weekly limits, the on-chain permission id behind every
  allowance, and the household's full history.
- **A member** is never told the size of the pot, or anything about anyone else.
  `GET /api/me` returns their own per-purchase limit, whether this payment
  clears, and their own payments — nothing more — and `/api/state` refuses them
  outright. A child's app is one question: who are you paying, and how much.

### The passkey layer — "passkey-gated", not passkey-native

```
WebAuthn PRF → 32 bytes → Secret Manager master-key mode → encrypts BIP-39 entropy
Face ID re-derives the key at every unlock; only ciphertext + salt persist
```

The on-chain signer is secp256k1, WDK's seed-derived key. There is **no** P-256
verification on-chain and no EIP-7212 dependency — calling this
"passkey-native" would describe a feature that isn't here. If an authenticator
has no PRF support the same vault runs on a PBKDF2 passphrase (100k,
SHA-256); both paths are tested in `server/src/vault.test.ts`. Invite links
carry a one-time token and **no key material**.

WDK runs in a small Node worker, mirroring WDK's own CLI daemon architecture,
and the browser does WebAuthn and UI only. This is not a stylistic choice:
`wdk-secret-manager` depends on native modules that cannot be bundled for a
browser (field note 3). The PRF output crosses only the TLS tunnel to that
worker and lives in memory for the session.

## Why Base Sepolia

The product needs a real Aave position denominated in USD₮, and exactly one
testnet can provide it.

On **Ethereum Sepolia**, Aave's USDT reserve sits about 2x over its supply cap,
so `supply()` reverts with error `51` (`SUPPLY_CAP_EXCEEDED`) for any amount at
all; USDC and DAI are in the same state, GHO's facilitator bucket is full, and
an aToken cannot be obtained any other way — the faucet only mints underlyings.
**Base Sepolia**'s USDT reserve is uncapped, liquid, and mintable from an
unpermissioned faucet. Check both for yourself:
`node spikes/probe-aave-reserves.mjs`.

The cost of that choice is that no provider prices gas in USD₮ there, which is
why we run our own paymaster (above) rather than dropping the requirement.

**Morpho was evaluated and rejected on evidence.** Morpho Blue's core is
deployed on both testnets, but the MetaMorpho vault factory is not, and
Morpho's own API indexes mainnets only — there is no vault to deposit into.
Using Morpho would have meant deploying and seeding its vault infrastructure
ourselves, which is a bespoke vault with extra steps. WDK also ships no Morpho
module; Aave is its only lending protocol.

**No APY is displayed anywhere.** Testnet rates are fiction. The claim this
demo makes is "the money sits in Aave and comes out gaslessly, to the merchant,
the moment a member spends" — which is what the receipts show.

## Field notes

Four things that cost real time, recorded because they aren't in any doc.

1. **`@tetherto/wdk-protocol-lending-aave-evm` cannot be used here** (beta.5).
   Its chain map covers mainnets only — no Sepolia, no Base Sepolia — and
   `supply()` requires `instanceof WalletAccountEvm || WalletAccountEvmErc4337`,
   which the 7702 gasless account is neither. So the Aave leg is direct pool
   calldata inside WDK-batched UserOperations, which demonstrates batching more
   honestly anyway.
2. **Pimlico's `eth_getUserOperationByHash` lags**, returning `null` for
   operations that are already on-chain. WDK's `waitForTransaction` polls that
   method first, so operations appeared stuck for ten minutes; polling
   `eth_getUserOperationReceipt` instead confirms the same operation in ~17
   seconds (`waitForUserOp`, `server/src/wdk.ts`).
3. **`wdk-secret-manager` needs a shim under Node.** It requires `bare-crypto`,
   whose binding only loads inside the Bare runtime, and uses exactly one API
   from it — `pbkdf2Sync`. We alias the module to `node:crypto` post-install
   (`server/shims/bare-crypto`, wired by `scripts/install-shims.mjs`). Also:
   `generateAndEncrypt` is `async` in the implementation despite a synchronous
   signature in the shipped `.d.ts`. Await it.
4. **The Aave testnet faucet has a per-address mint timelock.** One mint per
   day regardless of size, and it will happily mint a very large amount. Minting
   inside the deposit flow therefore worked exactly once: the second deposit of
   the day reverted with `Mint timelock exceeded`, and because a fee quote
   simulates the real batch, the quote failed with it. Funding now happens once
   at onboarding and deposits move only money already held.
5. **A self-hosted paymaster needs two things nobody mentions.** It must be
   *staked* with the EntryPoint, because reading the sender's token balance and
   allowance is external-storage access that ERC-7562 only permits from a staked
   paymaster. And its ERC-7677 stub response must **not** set `isFinal: true`:
   the client's order is stub → estimate → `pm_getPaymasterData`, the estimate
   step overwrites `paymasterPostOpGasLimit` with the bundler's guess (3,775 for
   us, against the ~25k a `transferFrom` needs), and only the final call
   restores the real value. A stub marked final short-circuits before that,
   and every operation reverts with `PostOpReverted` and empty revert data —
   which is what out-of-gas in `postOp` looks like.

## Run it from a clean clone

Prereqs: Node ≥ 22.18, [bun](https://bun.sh) (for installs), Foundry (only for
contract work), cloudflared (only to reach it from a phone).

```bash
git clone <this repo> && cd kin
cp .env.example .env        # fill in the values marked "you provide"
bun install && (cd server && bun install) && (cd web && bun install)
(cd web && bun run build)   # the server serves web/dist
(cd server && bun run start)

# To use Face ID, the page must be on HTTPS — a tunnel is the easiest way:
cloudflared tunnel --url http://localhost:8787
```

Open the URL, start a family, and follow the two-step setup. Passkeys are tied
to a browser profile, so open a member's invite link in a **second browser or
private window** — otherwise their Face ID unlocks the parent's account.

`./scripts/e2e-demo.sh` runs all five beats headlessly via the passphrase
vault path, printing every transaction hash. This was last verified from a
fresh `git clone`.

Other things worth running:

```bash
cd contracts && forge test                 # 28 tests: manager + paymaster
cd server && bun run test                  # passkey vault, PRF and passphrase
node spikes/spike0-sponsored-op.mjs        # sponsored op from a fresh empty EOA
node spikes/spike1-aave-roundtrip.mjs      # gasless Aave deposit and withdraw
node spikes/spike2-usdt-fee-quote.mjs      # why Ethereum Sepolia's USD₮ is unusable
node spikes/spike3-own-usdt-paymaster.mjs  # gas paid in USD₮, no native coin held
node spikes/probe-aave-reserves.mjs        # the supply-cap evidence quoted above
node spikes/verify-spend.mjs <txHash>      # decode a payment's settlement path
node spikes/verify-fees.mjs <txHash>       # decode who paid for an operation
```

The contracts above are already deployed. To redeploy:

```bash
cd contracts
forge script script/DeployBase.s.sol      --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast
forge script script/DeployPaymaster.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast
```

`DeployPaymaster` also funds the paymaster's EntryPoint deposit and stakes it;
without the stake, bundlers reject every operation (field note 4).

## Reuse disclosure

The author works on JAW, a passkey-native smart-account SDK with an on-chain
permission manager, and `ScopedSpendManager` is conceptually adjacent to that
work. The contract here was written from scratch this weekend with no code
imported, the delegate is eth-infinitism's `Simple7702Account` rather than a JAW
account, and every WDK integration in this repo is new. WDK's gasless module is
the execution layer; the contracts are the spend policy and the fee path on top.
A consumer app, not an SDK.

## Non-goals

Multi-chain, recurring billing, cross-chain anything, APY displays, custodial
backends, account recovery beyond the encrypted-blob restore, general-purpose
SDKs. One chain, one protocol, two screens, five beats.
