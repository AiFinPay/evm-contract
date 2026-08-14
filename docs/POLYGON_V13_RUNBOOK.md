# Polygon B2BSplitter v1.3 — deployment runbook and E2E checklist

> ## ⛔ STALE — DO NOT EXECUTE (AIFINP-119)
>
> This runbook was written against the 100/1 merchant profile and a SHA that has
> since changed. Every one of the following is now wrong:
>
> - expects `treasuryBps` 100 / `ipCreatorBps` 1 — the AIFP-2 deployment is **0/0**
> - asserts `MIN_MERCHANT_AMOUNT` = 100000 — **that constant no longer exists**
> - deploy command omits the now-mandatory `FEE_PROFILE` — the script will abort
> - verify command omits the fee bps arguments — the constructor tuple is incomplete
> - paid-E2E deltas expect a 100bp treasury and 1bp creator leg — at 0/0 both are zero
> - test count is stale
>
> Per the 14 August founder review this must be **regenerated wholesale against
> the final post-fix release-candidate SHA**, not patched line by line. Leaving
> the text below for reference only.

**Status: not authorised.** Dmitry's instruction is a separate approval for
**one specific Polygon mainnet transaction**, given after the gates in §0 are
closed. Nothing in this document may be executed before that.

This runbook exists so that the approval, when it comes, is for something
precisely specified rather than an open-ended "go ahead".

---

## 0. Gates that must close first

| Gate | Owner | Status |
|---|---|---|
| Independent review of EVM v1.3 | reviewer who did not author it | ❌ **open** |
| EVM CodeQL alert | me | ✅ closed — `permissions: contents: read` added |
| Registry → SDK propagation | me | ✅ closed — SDK builds its table from the canonical registry, drift fails CI |
| Versions 2.0.0 + correct MCP dependency | me | ✅ closed — both at 2.0.0, clean install resolves one SDK |
| Clean tarball install test | me | ✅ closed — `sdk/docs/CLEAN_MACHINE_EVIDENCE.md` |
| This runbook / E2E checklist | me | ✅ closed — this document |

**One gate remains: the independent review.** Everything else is done.

---

## 1. What the transaction actually is

A single `CREATE` deploying `B2BSplitterV13` to Polygon mainnet.

| | Value |
|---|---|
| Contract | `B2BSplitterV13` |
| Chain | Polygon mainnet, chainId 137 |
| Constructor `initialOwner` | `0xD31d82c4b35DABaA2ad7023C89A78A052D1f3c8e` (Safe) |
| Constructor `_treasury` | `0xD31d82c4b35DABaA2ad7023C89A78A052D1f3c8e` (Safe) |
| Constructor `_usdc` | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` (6dp) |
| Constructor `_usdt` | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` (6dp) |
| Cost | Polygon gas only, paid by the deployer key |

**It is a new address.** Nothing is upgraded, replaced or migrated. The
existing v1.2 splitter at `0xbD1fa5453f212F096c0213788a645eC597FB4DDe` keeps
working for anything already pointing at it, and its funds are untouched.

Owner and treasury are the Safe **from the constructor**, not transferred
afterwards. There is no window in which a single key controls the contract.
The script refuses to deploy if the owner address has no code, which is what
stops a repeat of v1.2 falling back to the deployer EOA on chains without a
Safe.

---

## 2. Pre-flight

Run against a fork before mainnet:

```
npx hardhat compile
npx hardhat test                        # expect 154 passing
npx solhint 'contracts/**/*.sol' --config .solhint.json
npm run prettify:check
node scripts/verify-registry.mjs        # 6/6 against live chain state
```

Confirm before proceeding:

- [ ] Independent review of v1.3 signed off, with the reviewer named
- [ ] `git status` clean, and the commit SHA recorded
- [ ] Deployer key funded with POL for gas
- [ ] Safe `0xD31d82c4…` confirmed to have code on Polygon (the script checks)
- [ ] Dmitry's explicit approval **for this specific transaction**

---

## 3. Deploy

```
npx hardhat run scripts/deploy-splitter-v13.ts --network polygon
```

The script reads each token's `decimals()` from the chain rather than assuming
6, then writes `deployments/polygon-v13-latest.json` containing the address,
constructor arguments, runtime code hash, token decimals and a **staged**
registry entry with `enabled: false`.

Record from the output:

- [ ] Deploy transaction hash
- [ ] Contract address
- [ ] Runtime code hash
- [ ] `treasuryBps` = 100, `ipCreatorBps` = 1, `MIN_MERCHANT_AMOUNT` = 100000

---

## 4. Verify the source

```
npx hardhat verify --network polygon <address> \
  0xD31d82c4b35DABaA2ad7023C89A78A052D1f3c8e \
  0xD31d82c4b35DABaA2ad7023C89A78A052D1f3c8e \
  0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359 \
  0xc2132D05D31c914a87C6611C10748AEb04B58e8F
```

- [ ] Polygonscan shows verified source
- [ ] `owner()` and `treasury()` both return the Safe
- [ ] The selector `0x894eb1f3` is present in the deployed bytecode

---

## 5. Promote the registry entry — still not payable

```
# in registry/registry.json, set polygon to version 1.3 and the new address,
# clear runtimeCodeHash so it is re-pinned from the chain rather than assumed
node scripts/verify-registry.mjs --pin
node scripts/generate-sdk-table.mjs
```

- [ ] `verify-registry.mjs` passes 6/6 with polygon now v1.3
- [ ] The pinned runtime code hash equals the one recorded at deploy
- [ ] `treasury`, `treasuryBps` and `ipCreatorBps` re-read from the new contract
- [ ] `settlementEnabled` still **false**

Then propagate to the SDK:

```
cd ../sdk/node && npm run registry:sync && npm run build && npm test
```

- [ ] SDK tests pass with the new entry
- [ ] `npm run registry:check` passes

**Settlement stays off at this point.** A deployed, verified contract is still
not a payable route.

---

## 6. Paid balance-delta E2E — the actual gate

One real payment, small, on mainnet. Requires its own approval.

Before:

- [ ] Record merchant, treasury and creator balances
- [ ] Record the payer balance

Execute a single `payNative` with a merchant amount just above
`MIN_MERCHANT_AMOUNT`, then assert **exactly**:

- [ ] merchant balance increased by **exactly** `merchantAmount` — not
      approximately, and not less. The whole point of v1.3 is that the merchant
      is not short-paid.
- [ ] treasury increased by exactly `merchantAmount × 100 / 10000`
- [ ] creator increased by exactly `merchantAmount × 1 / 10000`
- [ ] payer decreased by `total + gas`, where `total` is the sum of the three
- [ ] contract balance is **zero** — nothing retained
- [ ] the `Payment` event carries the same components
- [ ] replaying the same `paymentId` **reverts**

If any delta is off by even one wei, stop. That is the fee model being wrong,
which is the entire reason v1.3 exists.

---

## 7. Enable settlement — Polygon only

Only after §6 passes:

- [ ] `settlementEnabled: true` for polygon in `registry/registry.json`
- [ ] regenerate, re-sync to the SDK, re-run tests
- [ ] backend and SDK rollout
- [ ] support matrix updated: Polygon moves to settlement enabled + paid E2E
      verified. **Every other network stays disabled.**

That takes us to **1 of 13**, and no further. Base, Optimism, Unichain, BOT
Chain and XRPL EVM remain on fee-inclusive v1.1/v1.2 and keep refusing. The
three EOA-owned chains cannot be deployed at all until they have Safes.

---

## 8. If something goes wrong

There is no upgrade path and no admin key that can move funds — v1.3 has no
sweep function, which is deliberate.

- **Deploy fails:** nothing happened beyond spent gas. Fix and re-run.
- **Verification fails:** the contract exists but stays out of the registry. It
  is unreferenced and harmless.
- **A balance delta is wrong in §6:** do **not** enable settlement. Leave
  `settlementEnabled: false`; the route stays refused and the only loss is the
  test payment.
- **A problem appears after enabling:** set `settlementEnabled: false`,
  regenerate, re-sync, ship. The SDK then fails closed on that route again.
  `pause()` on the contract is also available to the Safe.

The rollback in every case is the registry flag, not a contract operation.
That is why settlement is a registry field rather than contract state.
