# Polygon B2BSplitter v1.3 — deployment runbook and E2E checklist

**Regenerated 2026-08-15 against release-candidate SHA `e96306b` per the
14 August founder review (AIFINP-119 P0-4).** This deployment is the
**AIFP-2 agent-x402 profile: 0/0** — no treasury fee, no creator fee. The
AIFP-1 merchant profile (100/0) is a **separate deployment with its own
approval**; nothing in this document authorises it.

**Status: not authorised.** Dmitry's instruction is a separate approval for
**one specific Polygon mainnet transaction**, given after the gates in §0 are
closed. Nothing in this document may be executed before that.

This runbook exists so that the approval, when it comes, is for something
precisely specified rather than an open-ended "go ahead".

---

## 0. Gates that must close first

| Gate | Owner | Status |
|---|---|---|
| Independent human review of the post-fix SHAs | reviewer who did not author them | ❌ **open** |
| Contract P0-1: blanket `MIN_MERCHANT_AMOUNT` | me | ✅ closed — removed in `e96306b`, floor now follows the split |
| SDK P0-2: zero-fee quotes rejected | me | ✅ closed — fee floor gated on BPS > 0 (sdk `cb090c3`) |
| SDK P0-3: AIFP-1/AIFP-2 route policy | me | ✅ closed — entry-point-declared route class, fail-closed both ways (sdk `9730e57`, ADR-001) — **ADR needs founder sign-off** |
| AIFINP-118: bridges send `pay_native`, SDK read `pay_matic` | me | ✅ closed — both keys read, captured live fixture, legacy quotes still refused (sdk `6af342d`) |
| This runbook against the frozen candidate | me | ✅ closed — this document, SHA `e96306b`, 167 tests |

**One gate remains: the independent review — and it must approve the SHAs
above, not any earlier state.**

---

## 1. What the transaction actually is

A single `CREATE` deploying `B2BSplitterV13` to Polygon mainnet **at 0/0**.

| | Value |
|---|---|
| Contract | `B2BSplitterV13` |
| Chain | Polygon mainnet, chainId 137 |
| Candidate SHA | `e96306b` (branch `security/fee-on-top-v13-remediation`) |
| Fee profile | **`agent-x402` → `treasuryBps 0`, `ipCreatorBps 0`** |
| Constructor `initialOwner` | `0xD31d82c4b35DABaA2ad7023C89A78A052D1f3c8e` (Safe) |
| Constructor `_treasury` | `0xD31d82c4b35DABaA2ad7023C89A78A052D1f3c8e` (Safe) |
| Constructor `_usdc` | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` (6dp) |
| Constructor `_usdt` | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` (6dp) |
| Constructor `_treasuryBps` | `0` |
| Constructor `_ipCreatorBps` | `0` |
| Cost | Polygon gas only, paid by the deployer key |

**It is a new address.** Nothing is upgraded, replaced or migrated. The
existing v1.2 splitter at `0xbD1fa5453f212F096c0213788a645eC597FB4DDe` keeps
working for anything already pointing at it, and its funds are untouched.

The split is a **constructor parameter** — nothing is compiled in. The deploy
script requires `FEE_PROFILE` (no default), reads the split back from the
chain after `CREATE`, and **aborts if it disagrees** with the profile. Owner
and treasury are the Safe from the constructor; the script refuses any chain
whose owner address has no code. `MAX_TOTAL_FEE_BPS = 500` bounds any later
`setSplit` by the owner.

There is no `MIN_MERCHANT_AMOUNT`. At 0/0 the only floor is
`_merchantAmount > 0` — one base unit settles, which is what makes the
sub-cent AIFP tiers representable.

---

## 2. Pre-flight

Run at the candidate SHA before mainnet:

```
npx hardhat compile
npx hardhat test                        # expect 167 passing / 0 failing
node_modules/.bin/solhint 'contracts/**/*.sol'   # 0 errors
npm run prettify:check
node scripts/verify-registry.mjs        # 6/6 against live chain state
```

Confirm before proceeding:

- [ ] Independent review signed off **on `e96306b` (contract) and `6af342d`
      (SDK branch head)**, with the reviewer named
- [ ] ADR-001 (route policy) confirmed by Dmitry
- [ ] `git status` clean, HEAD = `e96306b`
- [ ] Deployer key funded with POL for gas
- [ ] Safe `0xD31d82c4…` confirmed to have code on Polygon (the script checks)
- [ ] Dmitry's explicit approval **for this specific transaction**

---

## 3. Deploy

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
FEE_PROFILE=agent-x402 npx hardhat run scripts/deploy-splitter-v13-production.ts --network polygon
```

The script reads each token's `decimals()` from the chain rather than assuming
6, re-reads `treasuryBps`/`ipCreatorBps` from the deployed contract and aborts
on any mismatch with the profile, then writes
`deployments/polygon-v13-latest.json` containing the address, the full
constructor argument tuple, runtime code hash, token decimals, the
`feeProfile` name, and a **staged** registry entry with `enabled: false`.

Record from the output:

- [ ] Deploy transaction hash
- [ ] Contract address
- [ ] Runtime code hash
- [ ] `treasuryBps` = **0**, `ipCreatorBps` = **0**, read back from the chain
- [ ] `feeProfile` = `agent-x402` in the staged registry entry

---

## 4. Verify the source

The verify command carries the **full six-argument constructor tuple** —
omitting the two bps arguments makes verification fail against the deployed
bytecode:

```
npx hardhat verify --network polygon <address> \
  0xD31d82c4b35DABaA2ad7023C89A78A052D1f3c8e \
  0xD31d82c4b35DABaA2ad7023C89A78A052D1f3c8e \
  0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359 \
  0xc2132D05D31c914a87C6611C10748AEb04B58e8F \
  0 \
  0
```

- [ ] Polygonscan shows verified source
- [ ] `owner()` and `treasury()` both return the Safe
- [ ] `treasuryBps()` = 0 and `ipCreatorBps()` = 0 on-chain
- [ ] The v1.3 selector `0x894eb1f3` is present in the deployed bytecode

---

## 5. Promote the registry entry — still not payable

```
# in registry/registry.json, add the polygon v1.3 entry with the new address
# and feeProfile agent-x402; clear runtimeCodeHash so it is re-pinned from
# the chain rather than assumed
node scripts/verify-registry.mjs --pin
node scripts/generate-sdk-table.mjs
```

- [ ] `verify-registry.mjs` passes with polygon v1.3 present — note a 0 bps
      fee verifies as **0**, not as "missing" (strict null checks, not falsy)
- [ ] The pinned runtime code hash equals the one recorded at deploy
- [ ] `treasury`, `treasuryBps` (0) and `ipCreatorBps` (0) re-read from the
      new contract
- [ ] `settlementEnabled` still **false**

Then propagate to the SDK:

```
cd ../sdk/node && npm run registry:sync && npm run build && npm test
```

- [ ] SDK tests pass with the new entry
- [ ] `npm run registry:check` passes
- [ ] The entry satisfies the `agent-x402` route class in
      `ROUTE_FEE_PROFILES` — `call()` payments route to it; `fetchPaid()`
      (AIFP-1) must still refuse it (`route_fee_profile_mismatch`)

**Settlement stays off at this point.** A deployed, verified contract is still
not a payable route.

---

## 6. Paid balance-delta E2E — the actual gate

One real payment, small, on mainnet, through the full zero-fee path:
**bridge 402 (`pay_native` block, per AIFINP-118) → SDK validation under the
`agent-x402` route → local signing → contract → protected response → replay
rejection.** Requires its own approval.

Before:

- [ ] Record merchant, treasury and creator balances
- [ ] Record the payer balance

Execute a single `payNative` with a small merchant amount (below the old
$0.10 floor on purpose — e.g. the $0.0005 tier equivalent), then assert
**exactly**:

- [ ] merchant balance increased by **exactly** `merchantAmount` — not
      approximately, and not less
- [ ] treasury delta is **exactly 0** — this is the 0% claim, measured
- [ ] creator delta is **exactly 0**
- [ ] payer decreased by `merchantAmount + gas` and nothing more
- [ ] `msg.value` equalled `merchantAmount` exactly (`IncorrectNativeValue`
      guards this)
- [ ] contract balance is **zero** — nothing retained
- [ ] the `Payment` event carries the same components
- [ ] replaying the same `paymentId` **reverts**

If any delta is off by even one wei, stop. That is the fee model being wrong,
which is the entire reason v1.3 exists.

---

## 7. Enable settlement — Polygon only

Only after §6 passes:

- [ ] `settlementEnabled: true` for the polygon v1.3 entry in
      `registry/registry.json`
- [ ] regenerate, re-sync to the SDK, re-run tests
- [ ] backend and SDK rollout — **publish the SDK only after this**, and
      announce 0% publicly only after a clean-install check of the published
      package
- [ ] support matrix updated: Polygon moves to settlement enabled + paid E2E
      verified. **Every other network stays disabled.**

That takes us to **1 of 13**, and no further. Base, Optimism, Unichain, BOT
Chain and XRPL EVM remain on fee-inclusive v1.1/v1.2 and keep refusing — for
**both** route classes, per ADR-001. The EOA-owned chains cannot be deployed
at all until they have Safes. The AIFP-1 100/0 deployment, when approved, is
a second `CREATE` with `FEE_PROFILE=merchant-aifp1` and its own copy of this
checklist.

---

## 8. If something goes wrong

There is no upgrade path and no admin key that can move funds — v1.3 has no
sweep function, which is deliberate.

- **Deploy fails:** nothing happened beyond spent gas. Fix and re-run.
- **Profile read-back mismatch:** the script aborts before writing evidence.
  Nothing to roll back; investigate before retrying.
- **Verification fails:** the contract exists but stays out of the registry.
  It is unreferenced and harmless.
- **A balance delta is wrong in §6:** do **not** enable settlement. Leave
  `settlementEnabled: false`; the route stays refused and the only loss is the
  test payment.
- **A problem appears after enabling:** set `settlementEnabled: false`,
  regenerate, re-sync, ship. The SDK then fails closed on that route again.
  `pause()` on the contract is also available to the Safe.

The rollback in every case is the registry flag, not a contract operation.
That is why settlement is a registry field rather than contract state.
