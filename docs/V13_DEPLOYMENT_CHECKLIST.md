# B2BSplitter v1.3 — pre-deployment checklist

**Status: prepared, not deployed. Mainnet deployment requires explicit
approval and is a separate controlled operation.**

## Why this is blocking other work

The SDK's payment-target registry refuses any route whose version is not
`1.3` (`fee_inclusive_splitter_disabled`). Polygon's registered splitter is
still v1.2, so **EVM settlement currently fails closed in the SDK — both the
bridge `call()` path and the AIFP-1 gateway path**. That is deliberate: v1.1
and v1.2 are fee-inclusive and would pay the merchant *less* than a fee-on-top
quote promises. Deploying v1.3 and promoting the registry entry is what
re-opens EVM settlement.

## The economic invariant

Merchant receives the full quoted merchant amount. The protocol fee is
calculated **on that merchant amount and added on top**. The creator fee is
optional and separately added on top. On every branch:

```
merchant + treasury + creator == total received
```

If the creator is the zero address, the creator fee is **not taken at all** —
no amount is deducted and stranded.

There is **no blanket minimum payment**. The only universal floor is that the
merchant amount must be non-zero. Beyond that, a payment is rejected only when a
fee leg that is actually charged would round to zero, so the effective floor
follows the configured split:

| Profile | Effective minimum | On a 6-decimal stablecoin |
|---|---|---|
| `agent-x402` (0/0) | 1 base unit | any amount |
| `merchant-aifp1` (100/0) | 100 base units | $0.0001 |
| any profile with a non-zero creator leg (1 bps) | 10,000 base units | $0.01 |

The `merchant-aifp1` figure matters: the AIFP-1 per-request tiers start at
$0.0005, which the old blanket floor rejected outright. At 100/0 the binding
constraint is the 1% treasury leg, so the lowest tier settles.

A fixed raw-unit minimum was removed deliberately (AIFINP-119): the same 100,000
base units is $0.10 on a 6-decimal token and dust on an 18-decimal one, so it was
never a meaningful economic threshold — and at 0 bps there are no fee legs to
round, so no minimum is needed at all.

Verified by `test/unit/B2BSplitter.v13.test.ts` and
`test/unit/B2BSplitter.v13.stable.test.ts`: zero creator, non-zero creator,
native, stablecoin, replay on both paths, wrong total, wrong token, zero
token, short approval, 6- and 18-decimal tokens, below-minimum, and exactly-
minimum. Contract balance is asserted to be zero after every branch.

## ABI — must match exactly

| | Signature | Selector |
|---|---|---|
| **v1.3 native** | `payNative(NativePayment)` | `0x27a3bbaf` |
| **v1.3 stable** | `payStable(StablePayment)` | `0x7d452d37` |
| v1.2 (legacy) | `payNative(bytes32,address,address,string)` | `0x8f0122bb` |
| v1.1 (legacy) | `payMatic(address,address,string)` | `0xfa3014a0` |

The Node SDK encodes the v1.3 native form and is covered by
`node/tests/v13CallData.test.ts`, which asserts the literal selector, the
argument order, and that a v1.1/v1.2 target is refused.

**The SDK does not yet use `payStable`.** Stablecoin settlement exists in the
contract but has no SDK path; it must not be advertised as supported.

## Per-network checklist

Complete every row before deploying that chain. An empty cell is a blocker.

| | Polygon | Optimism | BOT Chain | XRPL EVM |
|---|---|---|---|---|
| Chain ID | 137 | 10 | 677 | 1440000 |
| RPC | `POLYGON_MAINNET_RPC` | `OPTIMISM_MAINNET_RPC` | configured | configured |
| Owner (must be a contract) | Safe `0xD31d82c4…1f3c8e` | ❌ **no Safe yet** | ❌ **no Safe yet** | ❌ **no Safe yet** |
| Treasury | Safe `0xD31d82c4…1f3c8e` | ❌ | ❌ | ❌ |
| USDC | `0x3c499c54…5c3359` (6dp) | `0x0b2c639c…7ff85` (6dp) | not supported | not supported |
| USDT | `0xc2132d05…b58e8f` (6dp) | `0x94b008aa…58e58` (6dp) | `0xababc7dd…87a3c` | not supported |
| Expected runtime code hash | recorded at deploy | | | |
| Registry entry | staged, `enabled: false` | | | |
| Paid E2E observed | ❌ | ❌ | ❌ | ❌ |

**Only Polygon can be deployed today.** The deploy script refuses any chain
without a configured contract owner — v1.2 fell back to the deployer EOA,
which is how Optimism, BOT Chain and XRPL EVM ended up owned by
`0x1D5e…fAB9` while Polygon was Safe-governed. Deploying v1.3 the same way
would repeat that. Create each chain's Safe and add it to `PRODUCTION_EVM_NETWORKS` in
`scripts/v13-production-config.ts`.

## Deploy

> **Use `scripts/deploy-splitter-v13-production.ts`.** The older
> `scripts/deploy-splitter-v13.ts` carries its own `TOKENS` table, and that
> table disagrees with the deployed reality: it names USDT on Polygon,
> Optimism and BOT Chain, none of which are whitelisted on the live v1.3
> splitters (read from chain 2026-08-27). It also has no entry for BNB Chain,
> Unichain, Base, Arbitrum or Avalanche, so it refuses five of the nine chains
> v1.3 actually runs on. The production script reads
> `scripts/v13-production-config.ts`, which is what the live routes were
> deployed from.

```
npx hardhat compile
npx hardhat test
npx hardhat run scripts/deploy-splitter-v13-production.ts --network <name>
```

The script reads each token's `decimals()` from the chain rather than
assuming 6 — BNB Chain's USDC is 18 decimals, and an assumed value there
produces a payment off by twelve orders of magnitude. It records the address,
constructor arguments, runtime code hash and token decimals to
`deployments/<network>-v13-latest.json`.

## Verify

```
npx hardhat verify --network <name> <address> <owner> <treasury> <usdc> <usdt>
```

## Promoting the registry entry — the gate

The deploy script writes `registryEntryStaged` with `enabled: false`. It stays
disabled until all three hold:

1. Source verification succeeded on the block explorer.
2. The on-chain runtime code hash matches the hash in the deployment record
   **and** the hash that goes into the SDK registry entry.
3. A paid end-to-end settlement has been observed on that chain.

Deployed ≠ verified ≠ settlement-enabled ≠ E2E-proven. Keep them separate;
do not collapse them into "supported".

## Not done here

- Independent contract review of v1.3 (PR #9) — required before mainnet.
- Reproducible build on a clean machine.
- Any mainnet transaction. Nothing in this package has been deployed.
