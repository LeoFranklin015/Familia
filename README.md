# Kin — a family allowance wallet, gasless on WDK

**Tether WDK Track 2 (gasless) · Ethereum Sepolia · EIP-7702 + ERC-4337**

One household pot of **USD₮** that family members spend from directly, within
limits the guardian sets **on-chain** — without ever holding a native token or
seeing a seed phrase.

The parent funds the pot and moves it into a savings position (faucet mint +
approve + deposit, **one sponsored UserOperation** — the parent starts from a
completely empty EOA and never touches ETH). They send an invite link. A member taps it, does
Face ID once, and has a working account: no app install, no funding step, no
seed phrase shown. The parent grants each member a scope — per-purchase cap,
per-week cap, optional expiry and recipient allowlist — enforced by a small
contract. Members spend against that scope; the money is redeemed out of the
parent's savings position and paid to the merchant **in the same transaction**.
Over the cap, the spend doesn't fail — it becomes an on-chain request the
parent approves from their phone. Revocation is instant and on-chain.

Members never hold funds and never hold ETH. Their gas is fully sponsored.

## The five demo beats (all verified on Sepolia)

| # | Beat | Proof |
|---|---|---|
| 1 | Parent deposits 500 USD₮ into the savings position | [mint+approve+supply, one sponsored op](https://sepolia.etherscan.io/tx/0xa853574a5d32fd9765f057313a07310788e712155cc2df529e104162f1bb6f9a) |
| 2 | Member joins by link, Face ID, zero balance of anything | address exists before any transaction — plain EOA under EIP-7702 |
| 3 | Member spends 8 USD₮: redeemed from savings → merchant, no gas | [spend, one member-signed sponsored op](https://sepolia.etherscan.io/tx/0x30281b1bb274e5373308da6a877673294a8857574826dd575983adc95ad64694) |
| 4 | Member tries 200 (over cap) → becomes an ask → parent approves → clears | request + approval both on-chain |
| 5 | Parent revokes → next attempt refused by the contract | `Revoked()` — see `contracts/test` |

Run them yourself: `./scripts/e2e-demo.sh` (against a running server).

## Where WDK is used (the integration, exactly)

| WDK surface | File / line | What it does here |
|---|---|---|
| `new WDK(seed).registerWallet(...)` + `wdk-wallet-evm-7702-gasless` | [`server/src/wdk.ts` L25](server/src/wdk.ts#L25) | Every account (parent and members) is a 7702-delegated EOA; all writes are ERC-4337 UserOperations built and signed by WDK |
| Batched `sendTransaction([...])`, sponsored | [`server/src/routes/parent.ts` L43](server/src/routes/parent.ts#L43) (deposit: faucet mint + ERC-20 approve + Aave supply), [L69](server/src/routes/parent.ts#L69) (bounded aToken approve + grant), [L90](server/src/routes/parent.ts#L90) (revoke + allowance reset), [L119](server/src/routes/parent.ts#L119) (allowance headroom + approveRequest + reset, atomic) | Multi-call flows land as **one** gasless UserOperation |
| Member `sendTransaction`, sponsored | [`server/src/routes/member.ts` L83](server/src/routes/member.ts#L83) (spend), [L98](server/src/routes/member.ts#L98) (requestSpend) | The member's own account signs; `sender` is the member's EOA — authorization is the contract's job |
| `getUserOperationReceipt` polling | [`server/src/wdk.ts` L86](server/src/wdk.ts#L86) | Receipt-first waiting (see "field notes" below for why) |
| `@tetherto/wdk-secret-manager` | [`server/src/vault.ts` L40](server/src/vault.ts#L40) | Encrypts wallet entropy at rest; master-key mode takes the WebAuthn PRF output, PBKDF2 passphrase fallback |
| WDK policy engine `registerPolicy` | [`server/src/wdk.ts` L37](server/src/wdk.ts#L37) | Member session accounts are locally denied any transaction that doesn't target the spend manager — defense in depth. The engine has no persistent counters, so it cannot express "120 per week" by itself; it's a UX/safety affordance. **The contract is the enforcement.** |

WDK packages and installed versions:

| Package | Version |
|---|---|
| `@tetherto/wdk` | 1.0.0-beta.16 |
| `@tetherto/wdk-wallet-evm-7702-gasless` | 1.0.0-beta.4 |
| `@tetherto/wdk-secret-manager` | 1.0.0-beta.3 |

**Integration boundary:** WDK's gasless module is the execution layer for
everything — deposits, grants, spends, approvals, revocations are all WDK-built
UserOperations. The savings and policy contracts are ours, called as plain
calldata inside those UserOperations. This is a consumer app, not an SDK.

## Architecture

```
parent  ──WDK 7702──▶ [faucet.mint(USDT) + USDT.approve(vault) + vault.deposit]  (1 sponsored op)
parent  ──WDK 7702──▶ [shares.approve(manager, Σ caps) + manager.grant(member, …)]
member  ──WDK 7702──▶ manager.spend(id, merchant, 8)
                        │ checks: caller, per-tx cap, period cap, expiry, allowlist
                        ├─▶ shares.transferFrom(parent → manager, 8)
                        └─▶ pool.withdraw(USDT, 8, merchant)      (same tx)
```

Three properties we did not break:

- **The parent keeps custody.** The pot is the parent's own position tokens in
  the parent's own EOA. The manager holds tokens only inside one `spend` call.
- **The member's UserOp has `sender` = the member's own account**, signed by the
  member's own key. The manager does the authorization.
- **Bounded approvals, always.** The manager's allowance is the sum of
  outstanding period caps, recomputed on every grant/revoke — never
  `type(uint256).max`. Approving an over-cap request raises the allowance by
  exactly the request amount and resets it in the same atomic UserOp.

### Contracts (Sepolia)

| Contract | Address |
|---|---|
| `ScopedSpendManager` (ours, written this weekend) | [`0xc18cC3F589493fB4B6f589b659AB87De82657De2`](https://sepolia.etherscan.io/address/0xc18cC3F589493fB4B6f589b659AB87De82657De2) |
| `SavingsVault` (ours — the USD₮ savings position) | [`0x5874F4c7E4D808a948F5F543b5C4F844Dc0D89F3`](https://sepolia.etherscan.io/address/0x5874F4c7E4D808a948F5F543b5C4F844Dc0D89F3) |
| `Simple7702Account` delegate (eth-infinitism v0.8, deployed by us) | [`0xf13097db790cC5d9386352dCa5b046629e6517c9`](https://sepolia.etherscan.io/address/0xf13097db790cC5d9386352dCa5b046629e6517c9) |
| EntryPoint v0.8 | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` |
| Pimlico Sepolia USD₮ (gas token) | `0xd077A400968890Eacc75cdc901F0356c943e4fDb` |
| USD₮ (family money, Aave's Sepolia testnet USDT) | `0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0` — imported from `@bgd-labs/aave-address-book`, no pasted hex |
| Aave V3 faucet (mints the test USD₮) | `AaveV3Sepolia.FAUCET` from the address book |

The contract is deliberately generic (`funder`/`spender`, `asset`/`source`):
household allowances, team budgets, agent spend caps and subscription mandates
are the same object. When `source == asset` it settles as a plain ERC-20 pull —
the app works with or without a savings leg at all. 25 Foundry tests cover
every named revert (`NotSpender`, `Revoked`, `Expired`, `OverPerTxCap`,
`OverPeriodCap`, `RecipientNotAllowed`, …), both settlement paths, and the
vault's equivalence to an Aave pool: `cd contracts && forge test`.

### The passkey layer — "passkey-gated", not passkey-native

```
WebAuthn PRF → 32 bytes → Secret Manager master-key mode → encrypts BIP-39 entropy
Face ID re-derives the key on every unlock; only ciphertext + salt persist
```

The on-chain signer is secp256k1 (WDK's seed-derived key). There is no P-256
verification on-chain and no EIP-7212 dependency. If the authenticator has no
PRF support, the same vault runs on a PBKDF2 passphrase (100k, SHA-256) —
tested both ways (`server/src/vault.test.ts`). Invite links carry a one-time
token and **no key material**. WDK runs in a small Node worker (mirroring WDK's
own CLI daemon architecture); the browser does WebAuthn and UI. The PRF secret
crosses only the TLS tunnel to that worker and lives in memory for the session.

## Testnet realities (read before judging the token choices)

- **Two USD₮s:** the family money is Aave's Sepolia testnet USD₮
  (`0xaA8E23Fb…`, freely faucet-mintable) while the paymaster prices gas in
  Pimlico's Sepolia USD₮ (`0xd077A4…`, owner-only mint). Both are testnet
  deployments of the same asset; on mainnet they are the one canonical USD₮.
- **Why the savings leg is our own vault, not Aave:** the family money is
  USD₮ and Aave V3 Sepolia simply cannot accept it — its USDT reserve sits
  ~2x over its supply cap (cap 2,000,000,000 vs ~4,060,000,000 supplied), so
  `supply()` reverts with Aave error 51 for **any** amount; USDC and DAI are in
  the same state and GHO's facilitator bucket is full. Rather than change the
  product's currency to something Aave would accept, `SavingsVault` implements
  Aave's exact pool interface (`withdraw(asset, amount, to)`) and holds USD₮
  1:1. Pointing the manager at Aave's real `POOL` with aUSDT as the source
  token is a constructor argument, not a code change — which is what happens on
  a network where the reserve works. `SavingsVault.t.sol` tests that
  equivalence, and `spikes/spike1-aave-roundtrip.mjs` proves the same batched
  gasless flow against Aave itself (in EURS, the one reserve there with room).
  Verify the cap situation yourself: `node spikes/probe-aave-reserves.mjs`.
- **Shares are 1:1 and there is no yield on testnet.** None is claimed or
  displayed. The claim the demo makes is "the money sits in a savings position
  and comes out gaslessly, to the merchant, the moment a member spends" — which
  is exactly what the receipts show.
- **Parent fee mode:** members are always fully sponsored. The parent is
  sponsored too because Pimlico's Sepolia USD₮ `mint` is owner-only, so a demo
  cannot acquire it programmatically to pay token-mode fees. The per-call
  token-mode override (`isSponsored: false` + `paymasterToken`) is supported by
  the account config we use and switches on with one env value.
- **No APY is displayed anywhere.** Testnet rates are fiction; the claim is
  "the money sits in Aave and comes out gaslessly the moment a member spends" —
  which is what the receipts show.

## Field notes (real findings from this weekend)

1. **`@tetherto/wdk-protocol-lending-aave-evm` can't be used here** (beta.5):
   its chain map has no Sepolia entry, and `supply()` requires
   `instanceof WalletAccountEvm || WalletAccountEvmErc4337` — the 7702 gasless
   account is neither. So the Aave leg is direct pool calldata inside
   WDK-batched UserOperations, which also demos batching honestly.
2. **Pimlico's `eth_getUserOperationByHash` lags** (returns `null` for ops that
   are already included), which stalls WDK's `waitForTransaction` — it polls
   byHash first. Ops that looked stuck for 10 minutes confirm in ~17s when you
   poll `eth_getUserOperationReceipt` instead (`waitForUserOp` in
   `server/src/wdk.ts`).
3. **`wdk-secret-manager` under Node** requires `bare-crypto`, whose binding
   only loads inside the Bare runtime. It uses exactly one API — `pbkdf2Sync` —
   so we alias the module to `node:crypto` post-install
   (`server/shims/bare-crypto`, wired in `scripts/install-shims.mjs`). Also:
   `generateAndEncrypt` is `async` in the implementation despite a sync
   signature in the shipped `.d.ts` — await it.

## Run it from a clean clone

Prereqs: Node ≥ 22.18, [bun](https://bun.sh) (installer only), Foundry
(only for contract work), cloudflared (only for phone/WebAuthn testing).

```bash
git clone <this repo> && cd kin
cp .env.example .env        # fill in the four values marked "you provide"
bun install && (cd server && bun install) && (cd web && bun install)
(cd web && bun run build)   # the server serves web/dist
(cd server && bun run start)
# optional, for Face ID on a real phone (WebAuthn needs HTTPS):
cloudflared tunnel --url http://localhost:8787
```

Then open the printed URL, create a family, open your own invite, and go.
`./scripts/e2e-demo.sh` runs the five beats headlessly (passphrase vault path)
— this was last verified end-to-end from a fresh `git clone` on Sepolia.

Other checks worth running:

```bash
cd contracts && forge test                    # 19 tests, every named revert
cd server && bun run test                     # passkey vault, PRF + passphrase
node spikes/spike0-sponsored-op.mjs           # sponsored op from a fresh empty EOA
node spikes/spike1-aave-roundtrip.mjs         # gasless Aave deposit + withdraw
node spikes/probe-aave-reserves.mjs           # the reserve evidence quoted above
```

Contracts are already deployed (addresses above, in `.env.example`). To
redeploy: `cd contracts && forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast`.

## Reuse disclosure

The author works on JAW, a passkey-native smart-account SDK with an on-chain
permission manager, and `ScopedSpendManager` is conceptually adjacent to that
work. The contract here was written from scratch this weekend (no code
imported), the delegate is eth-infinitism's `Simple7702Account` (not a JAW
account), and every WDK integration in this repo is new this weekend. WDK's
gasless module is the execution layer, and the contract is the spend policy on
top — a consumer app, not an SDK.

## Non-goals

Multi-chain, recurring billing, cross-chain anything, APY displays, custodial
backends, account recovery beyond the encrypted-blob restore, general-purpose
SDKs. One chain, one protocol, two screens, five beats.
