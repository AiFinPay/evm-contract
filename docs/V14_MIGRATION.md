# B2BSplitter v1.4 — Migration Plan from v5.3 Core / v1.3 Splitter

**Status:** design spec
**Scope:** files to delete, files to add, files to modify, in dependency order
**Pre-conditions:** `docs/V14_ARCHITECTURE.md` and `docs/V14_QUOTE_FORMAT.md` reviewed

This document is the **destructive** migration plan. It assumes the v1.4 design is approved and we are removing v5.3 / v1.3 contracts from the repository. The phasing is sequential; each phase ends in a green build (`bun run build && bun test && bun run lint && bun run prettify:check`).

---

## 1. Guiding Principles

1. **No code in this document.** This is a plan, not a patch. The actual code lands in separate, reviewable PRs.
2. **Branch per phase.** Each phase lands on its own branch; main is only fast-forwarded after the full sequence passes CI.
3. **Contracts come last.** Documentation and audit-update phases land first. Code removal happens only after docs are merged.
4. **Backwards compatibility is broken by design.** SDK and backend must move in lockstep with the on-chain deploy. There is no `settleLegacy()` escape hatch.
5. **No migration of state.** v1.4 is a fresh deployment; old v5.3 deployments continue to live (they have user seats, mSECCO balances, passport NFTs). We do not migrate state. Users who want v1.4 features re-mint via the new SDK.
6. **One contract, many routes.** v1.4 supports both `agent-x402` and `merchant-aifp1` in a single deployment via the `routeId` mechanism. We do **not** deploy separate contracts per route (this is the v1.3 model that v1.4 replaces).

---

## 2. Files Touched

### 2.1 Files to delete

| File | Reason |
|---|---|
| `contracts/AiFinPayCore.sol` | Replaced by `B2BSplitterV14`; off-chain concerns moved to backend |
| `contracts/MSECCOToken.sol` | Off-chain credit ledger |
| `contracts/AgentPassport.sol` | Off-chain identity |
| `contracts/B2BSplitter.sol` | v1.2, deprecated |
| `contracts/B2BSplitterV13.sol` | v1.3 replaced by v1.4 (multi-route + RBAC + signed quotes) |
| `contracts/mocks/MockPyth.sol` | No oracle integration in v1.4 |
| `contracts/interfaces/IPyth.sol` | No oracle integration in v1.4 |
| `test/unit/AiFinPayCore.test.ts` | No core contract |
| `test/unit/AgentPassport.test.ts` | No passport contract |
| `test/unit/MSECCOToken.test.ts` | No mSECCO contract |
| `test/unit/B2BSplitter.v12.test.ts` | v1.2 is removed |
| `test/unit/B2BSplitter.v13.test.ts` | v1.3 is removed |
| `test/unit/B2BSplitter.v13.stable.test.ts` | v1.3 is removed |
| `test/integration/contracts.test.ts` | Tests Core↔mSECCO↔Passport integration; those contracts are gone |
| `scripts/deploy.ts` | Deploys Core + Passport + mSECCO; replaced |
| `scripts/deploy-splitter-v13.ts` | v1.3 replaced by v1.4 |
| `scripts/deploy-splitter-v13-production.ts` | v1.3 replaced by v1.4 |
| `scripts/deploy-splitter-v13-local.ts` | v1.3 local helper; replaced |
| `scripts/e2e-stable-amoy.ts` | Tests Core reserveSeatStable + mSECCO mint; out of scope |
| `scripts/deploy-mock-stable-amoy.ts` | Mocks for v5.3 tests; out of scope |
| `scripts/deploy-safe-amoy.ts` | Safe deployment for v5.3; v1.4 uses Safe directly from `hardhat.config` |
| `scripts/generate-sdk-table.mjs` | Generates SDK table from v5.3 ABI; v1.4 SDK table is generated from `B2BSplitterV14` ABI |
| `scripts/verify-registry.mjs` | Verifies registry entries against v5.3 deployments; v1.4 has its own registry |
| `scripts/v13-production-config.ts` | v1.3 config; replaced by v1.4 config |
| `foundry-tests/Pironmind-Foundry.t.sol` | Tests Core; replaced by v1.4 Foundry tests |
| `config/v13-production-config.ts` | v1.3 config; replaced |
| `config/chains/polygon.json` (if it contains mSECCO/Passport/Core references) | Update to v1.4 splitter-only |
| `config/chains/amoy.json` (if it contains mSECCO/Passport/Core references) | Update to v1.4 splitter-only |
| `deployments/polygon.json` | Historical record of v5.3 deploy; preserve as `polygon-v5.3.json`, never overwrite |
| `deployments/amoy.json` | Same |

### 2.2 Files to add

| File | Purpose |
|---|---|
| `contracts/B2BSplitterV14.sol` | The new splitter-only contract with multi-route profiles and two-role RBAC |
| `test/unit/B2BSplitter.v14.test.ts` | Native path unit tests |
| `test/unit/B2BSplitter.v14.stable.test.ts` | Stable path unit tests |
| `test/unit/B2BSplitter.v14.signature.test.ts` | EIP-712 signature path unit tests |
| `test/unit/B2BSplitter.v14.rbac.test.ts` | RBAC + role rotation tests |
| `test/unit/B2BSplitter.v14.route.test.ts` | Multi-route profile tests (configure/disable/enable) |
| `foundry-tests/B2BSplitterV14.invariant.t.sol` | Foundry invariants for `_splitGross`, `ecrecover`, `consumedNonce` monotonicity, RBAC separation |
| `scripts/deploy-splitter-v14-production.ts` | v1.4 production deploy script |
| `scripts/deploy-splitter-v14.ts` | Generic v1.4 deploy |
| `scripts/verify-v14.ts` | Source-verification of v1.4 contracts |
| `scripts/v14-production-config.ts` | Production config with route profile bootstrap |
| `config/v14-production-config.ts` | Chain configs (USDC/USDT addresses, governance addresses) for v1.4 |
| `docs/AUDIT_B2BSplitterV14.md` | Audit report (after the actual code is written and reviewed) |
| `docs/V14_DEPLOYMENT_CHECKLIST.md` | Step-by-step deployment checklist |
| `docs/V14_FUTURE.md` | Tracked future work (storage pruning, fee-on-transfer probe, profile-bound digest, governance recovery, etc.) |

### 2.3 Files to modify

| File | Change |
|---|---|
| `contracts/errors/Errors.sol` | Strip Core/Passport/mSECCO/Pyth/manifesto errors; add v1.4 EIP-712 + RBAC + multi-route errors |
| `contracts/Whitelist.sol` | No change |
| `test/fixtures.ts` | Drop Core/Passport/mSECCO deployment; add `B2BSplitterV14` |
| `hardhat.config.ts` | Confirm network configurations unchanged; remove any Core-specific config (none expected) |
| `package.json` | Add new scripts: `deploy:v14`, `deploy:v14:testnet`, `verify:v14` |
| `foundry.toml` | Confirm no change |
| `README.md` | Replace v5.3 description with v1.4 |
| `docs/ARCHITECTURE.md` | Rewrite for splitter-only |
| `docs/BUSINESS_LOGIC.md` | Rewrite for splitter-only |
| `docs/IMPLEMENTATION.md` | Rewrite audit findings table; update contract addresses |
| `docs/TIMELOCK_SETUP.md` | Update for v1.4 RBAC bootstrap (grant SIGN_OPERATOR_ROLE in addition to transferring ownership) |
| `docs/TESTING_GUIDE.md` | Update test count, remove v1.2/v1.3 references |
| `AI_DISCOVERY.md` | Update contract summary |
| `AGENTS.md` | Update day-to-day commands (add `deploy:v14`), update test counts, update splitter canonical address |

---

## 3. Migration Phases

Each phase ends with a green CI. No phase is committed unless its preceding phase is also committed.

### Phase 0 — Document the new design (this PR)

**Goal:** Align all stakeholders on the design before any code lands.

**Commits:**
- `docs: add V14_ARCHITECTURE.md`
- `docs: add V14_QUOTE_FORMAT.md`
- `docs: add V14_MIGRATION.md`
- `docs: add V14_BACKEND_RISK_CLOSURE.md`

**Done when:** All four docs reviewed by at least one backend engineer and one Solidity engineer.

### Phase 1 — Update canonical docs to point at v1.4

**Goal:** ARCHITECTURE, BUSINESS_LOGIC, IMPLEMENTATION, README, AGENTS, AI_DISCOVERY reflect the new model. **No code, no deletion of existing contracts.**

**Commits:**
- `docs: rewrite ARCHITECTURE.md for splitter-only v1.4 (multi-route + RBAC)`
- `docs: rewrite BUSINESS_LOGIC.md for splitter-only v1.4`
- `docs: rewrite IMPLEMENTATION.md for splitter-only v1.4`
- `docs: update TIMELOCK_SETUP.md to bootstrap SIGN_OPERATOR_ROLE`
- `docs: update README.md, AGENTS.md, AI_DISCOVERY.md`

**Done when:** `grep -r "AiFinPayCore" docs/` returns no matches except in `V14_MIGRATION.md` (which describes the migration itself).

### Phase 2 — Add v1.4 contracts and tests

**Goal:** Implement and test v1.4 **alongside** v1.3/v5.3. Both versions coexist temporarily so we can verify v1.4 without touching existing deploys.

**Commits:**
- `feat: add B2BSplitterV14.sol with EIP-712 quote verification, multi-route profile, RBAC`
- `test: add B2BSplitterV14 unit tests (native, stable, signature, RBAC, routes)`
- `foundry: add B2BSplitterV14 invariant and fuzz tests`
- `feat: add v1.4 deploy scripts and v1.4 production config`
- `feat: add config/v14-production-config.ts`

**Done when:**
- `bun test` passes with both v1.3 and v1.4 tests green.
- `forge test` passes with both v1.3 and v1.4 Foundry tests green.
- `bun run lint` and `bun run prettify:check` pass on v1.4 files.
- v1.4 contract size is under the 24,576 byte EIP-170 limit.
- Constructor bootstrap enforces `initialAdmin != initialSigner` (test confirms).

### Phase 3 — Update fixtures and deploy scripts to dual-mode

**Goal:** `test/fixtures.ts` exposes both `fixtureV13` and `fixtureV14`. Deploy scripts are selectable via env var. Existing v1.3 deploy flow continues to work.

**Commits:**
- `test: split fixtures into v13/v14 deployments`
- `chore: deploy scripts support V14_PROFILE env var`

**Done when:** Both v1.3 and v1.4 deploy flows work on a local hardhat node.

### Phase 4 — Source verification of v1.4

**Goal:** Testnet deploy of v1.4 on Amoy; verify on Polygonscan. Both `agent-x402` and `merchant-aifp1` routes are configured at construction.

**Commits:**
- `chore: deploy v1.4 to Amoy testnet`
- `chore: verify v1.4 source on Amoy`

**Done when:** Contract is verified on the block explorer with constructor args visible.

### Phase 5 — Re-audit

**Goal:** Independent auditor reviews v1.4 (or internal senior auditor if external not budgeted). Findings become `docs/AUDIT_B2BSplitterV14.md`. The audit must specifically examine:

1. RBAC separation: can `SIGN_OPERATOR_ROLE` holder do admin actions? (Should be no.)
2. RBAC separation: can `ADMIN_ROLE` holder forge quotes? (Should be no.)
3. Multi-route profile change race: does ADMIN's profile change affect in-flight quotes? (See `V14_ARCHITECTURE.md` §5.4.)
4. `_splitGross` per-route math: does it produce correct totals for arbitrary profile combinations?
5. Replay protections: nonce, chainId, address, routeId.

**Commits:**
- `docs: add AUDIT_B2BSplitterV14.md`

**Done when:** All Critical and High findings are fixed or accepted. Medium and Low are documented.

### Phase 6 — Remove v1.3 / v5.3 contracts and tests

**Goal:** Clean removal of legacy code. This is the destructive phase. SDK and backend are assumed to have moved off v1.3/v5.3 by this point (separate, parallel work).

**Commits (each in a separate PR for reviewability):**
- `chore: remove AiFinPayCore.sol`
- `chore: remove AgentPassport.sol`
- `chore: remove MSECCOToken.sol`
- `chore: remove B2BSplitter.sol (v1.2)`
- `chore: remove B2BSplitterV13.sol`
- `chore: remove mocks/MockPyth.sol, interfaces/IPyth.sol`
- `test: remove AiFinPayCore, AgentPassport, MSECCOToken, B2BSplitter v1.2/v1.3 tests`
- `test: remove integration/contracts.test.ts`
- `chore: remove old deploy scripts (deploy.ts, e2e-stable-amoy.ts, deploy-mock-stable-amoy.ts, deploy-safe-amoy.ts, deploy-splitter-v13*)`
- `chore: remove foundry-tests/Pironmind-Foundry.t.sol`
- `chore: remove v1.3 config and registry records; preserve historicals under renamed files`
- `chore: trim errors/Errors.sol to v1.4 surface only`
- `test: trim fixtures.ts to v1.4 only`

**Done when:**
- `grep -r "AiFinPayCore\|MSECCOToken\|AgentPassport\|B2BSplitterV13\|B2BSplitter.sol" contracts/ test/ scripts/` returns no matches.
- `bun test` passes.
- `forge test` passes.
- `bun run lint` passes.
- `bun run prettify:check` passes.
- `bun run build` passes.

### Phase 7 — Production deploy

**Goal:** Deploy v1.4 to Polygon mainnet with full RBAC bootstrap:

- Owner (`ADMIN_ROLE`): `TimelockController` (48h delay), which itself is owned by a Gnosis Safe (4-of-4).
- `SIGN_OPERATOR_ROLE`: production KMS-backed public key.
- Treasury: Gnosis Safe 4-of-4.
- Both `agent-x402` and `merchant-aifp1` routes configured at construction.

**Commits:**
- `chore: deploy v1.4 to Polygon`
- `chore: verify v1.4 source on Polygon`
- `chore: transfer v1.4 ownership to TimelockController`
- `chore: grant SIGN_OPERATOR_ROLE to production KMS-backed key`
- `docs: update CLAUDE.md / docs with canonical v1.4 address`

**Done when:** Contract is verified, ownership is on the TimelockController, treasury is the Gnosis Safe, signer role is granted to the production KMS-backed public key.

---

## 4. Error Catalogue Migration

### 4.1 Errors removed

```solidity
// AiFinPayCore — all of these
error ZeroMSECCO();
error ZeroPassport();
error ZeroPartner();
error EmptyPartnerName();
error InvalidAgreementHash();
error ZeroNative();
error InsufficientNativeForFee();
error InvalidPythPrice();
error UnexpectedPriceExponent();
error BelowMinimum();
error NoSeatFound();
error PartnerNotActive();
error AgentNotVerifiedB2B();
error PaymentBelowMinimum();
error SpendAmountTooLarge();
error DailySpendLimitExceeded();
error ProtocolFeeFailed();
error BonusAlreadyClaimed();
error NoReferrals();
error FeesExceed100();
error TreasuryFeeTooLow();
error ARPFeeTooHigh();
error ProtocolPaused();

// MSECCOToken
error CoreAlreadySet();
error OnlyCore();
error NonTransferable();

// AgentPassport
error PassportAlreadyExists();
error NoPassport();
error Soulbound();
```

### 4.2 Errors retained (unchanged signature)

```solidity
error ZeroAmount();
error ZeroMerchant();
error PaymentAlreadyProcessed();     // renamed: see §4.4
error PaymentTooSmallForTreasury();
error PaymentTooSmallForRoyalty();
error ZeroTreasury();
error UnsupportedToken();
error MerchantTransferFailed();
error TreasuryTransferFailed();
error IPCreatorTransferFailed();
error TreasuryFeeTooHigh();
error IPCreatorFeeTooHigh();
error ZeroAddress();
error ArrayLengthMismatch();
error ZeroStablecoins();
error InvalidProductionSplit(uint256 treasuryBps, uint256 ipCreatorBps);  // repurposed: see §4.4
error IncorrectNativeValue(uint256 expected, uint256 received);
error MissingIPCreator();
error ZeroProposer();
error DelayTooShort();
error NotProposer();
```

### 4.3 Errors added in v1.4

```solidity
// EIP-712 quote
error InvalidSigner();
error InvalidSignature();
error InvalidSignatureLength();
error SignatureExpired(uint256 validUntil, uint256 currentTime);
error InvalidPayer();
error InvalidNonce();
error NonceAlreadyConsumed();                 // renamed from PaymentAlreadyProcessed
error NonceOverflow();
error InvalidOrderIdHash();
error InvalidTokenForNative();

// Multi-route profile
error UnknownRoute(bytes32 routeId);
error RouteDisabled(bytes32 routeId);
error TreasuryFeeTooHigh();                   // existing; now applies per-profile
error IPCreatorFeeTooHigh();                  // existing; now applies per-profile
error RouteAlreadyExists(bytes32 routeId);
error RouteNotFound(bytes32 routeId);
error RouteTreasuryZero();                    // routeTreasury == address(0) when set

// RBAC
error ZeroSigner();
error AdminEqualsSigner();                    // constructor: separation of duties
error ZeroAdmin();
error NoAdminRoleHolder();                    // guard against ADMIN=address(0)
```

### 4.4 Naming note

| Old error | New error | Reason |
|---|---|---|
| `PaymentExpired(validUntil, currentTime)` | `SignatureExpired(validUntil, currentTime)` | The expiry source is now the **signed quote**, not a caller-supplied field. Error name reflects the cause. |
| `PaymentAlreadyProcessed()` | `NonceAlreadyConsumed()` | v1.3's `consumedPayment[bytes32]` → v1.4's `consumedNonce[payer][uint256]`. New name describes the state, not the action. |
| `InvalidProductionSplit(treasuryBps, ipCreatorBps)` | **Removed** | v1.4 does not restrict to a closed set; `configureRoute` validates per-profile. The error is replaced by `TreasuryFeeTooHigh()` and `IPCreatorFeeTooHigh()` checks inside `configureRoute`. |

---

## 5. Test Migration

### 5.1 Tests removed

| File | Reason |
|---|---|
| `test/unit/AiFinPayCore.test.ts` | No core |
| `test/unit/AgentPassport.test.ts` | No passport |
| `test/unit/MSECCOToken.test.ts` | No mSECCO |
| `test/unit/B2BSplitter.v12.test.ts` | No v1.2 |
| `test/unit/B2BSplitter.v13.test.ts` | No v1.3 |
| `test/unit/B2BSplitter.v13.stable.test.ts` | No v1.3 |
| `test/integration/contracts.test.ts` | No Core↔mSECCO↔Passport interaction |

### 5.2 Tests added

| File | Coverage |
|---|---|
| `B2BSplitter.v14.test.ts` | Native split with signed quotes: happy path, replay, atomic rollback, deadline, msg.value mismatch |
| `B2BSplitter.v14.stable.test.ts` | Stable split: USDC/USDT, decimal-agnostic, replay, dead-quote rejection, rogue token, dust edge |
| `B2BSplitter.v14.signature.test.ts` | EIP-712 happy path, `ecrecover` fail, deadline expired, nonce mismatch, wrong signer role, replay same nonce, replay after cross-chain, replay after cross-contract, `routeId` mismatch, missing/invalid signature length |
| `B2BSplitter.v14.rbac.test.ts` | ADMIN-only methods, SIGN_OPERATOR_ROLE grant/revoke, pause/unpause, renounce, role separation (signer cannot admin, admin cannot sign), two-step ownership transfer |
| `B2BSplitter.v14.route.test.ts` | Constructor route bootstrap, `configureRoute` happy path, `configureRoute` reverts on cap violation, `disableRoute`/`enableRoute`, routeTreasury override, profile change race (settlements use new profile, see `V14_ARCHITECTURE.md` §5.4) |

### 5.3 Foundry tests

| Old test | New test |
|---|---|
| `Pironmind-Foundry.t.sol` (Core invariants) | `B2BSplitterV14.invariant.t.sol` (`_splitGross` invariant + `ecrecover` invariant + `consumedNonce` monotonicity + RBAC separation: signer cannot call admin functions; admin cannot forge signatures) |

### 5.4 RBAC test matrix (must pass)

| Caller | Function | Expected |
|---|---|---|
| `address(0)` | anything | reverts (no role) |
| EOA (no role) | `settleNative(...)` | reverts (no role) |
| EOA (no role) | `pause()` | reverts `AccessControlUnauthorizedAccount` |
| EOA (no role) | `setTreasury(...)` | reverts `AccessControlUnauthorizedAccount` |
| EOA (no role) | `grantSignerRole(...)` | reverts (no role) |
| EOA with `SIGN_OPERATOR_ROLE` | `settleNative(...)` | succeeds |
| EOA with `SIGN_OPERATOR_ROLE` | `pause()` | reverts (no admin role) |
| EOA with `SIGN_OPERATOR_ROLE` | `setTreasury(...)` | reverts |
| EOA with `SIGN_OPERATOR_ROLE` | `grantSignerRole(...)` | reverts |
| EOA with `ADMIN_ROLE` | `pause()` | succeeds |
| EOA with `ADMIN_ROLE` | `setTreasury(...)` | succeeds |
| EOA with `ADMIN_ROLE` | `configureRoute(...)` | succeeds |
| EOA with `ADMIN_ROLE` | `settleNative(...)` | reverts (no signer role) |
| EOA with both roles | everything | succeeds (purgatory state — discouraged but allowed) |

---

## 6. SDK Migration

Out of scope for this contract-side document, but documented here for completeness.

| Old SDK surface | New SDK surface |
|---|---|
| `client.quote(...)` (no signing) | `client.quote(...)` — receives pre-signed quote from backend (with `routeId`) |
| `client.payStable(paymentId, merchant, ...)` | `client.payStable(quote, signature)` |
| `client.payNative(paymentId, merchant, ...)` | `client.payNative(quote, signature)` |
| `client.reserveSeat(...)` | Removed — backend responsibility |
| `client.topUp(...)` | Removed — backend responsibility |
| `client.mintPassport(...)` | Removed — backend responsibility |
| `client.getRoutes()` (returns `agent-x402` or `merchant-aifp1`) | `client.getRoutes()` returns the list of `routeId`s the SDK understands + their display names (initial: `agent-x402`, `merchant-aifp1`) |

The SDK version is bumped from `5.x` to `6.0`. The breaking change is documented in `SDK_CHANGELOG.md` (new file).

The SDK must display to the user **which `routeId`** is being used, and the human-readable name. Routes added by ADMIN after the SDK is shipped will not be recognised by old SDKs — old SDKs gracefully refuse to submit quotes with unknown `routeId`s.

---

## 7. Backend Migration

Out of scope for this contract-side document, but flagged for the backend team.

The backend must:
1. Run an EIP-712 signing service (KMS-backed). The signing key's public key is registered with the contract via `grantSignerRole`.
2. Maintain a `payer_nonce` table synced with `payerNonce(payer)` on-chain.
3. Maintain a `daily_spend_limit` table per agent (moved from passport).
4. Maintain a `kyc_status` table per agent (moved from passport).
5. Maintain a `route_profile` cache (subscribed to `RouteConfigured`/`RouteDisabled` events) so the backend knows which routes are enabled and what their profiles are.
6. Replace direct calls to `AiFinPayCore.b2bPay(...)` with `B2BSplitterV14.settleNative(...)` / `settleStable(...)`.
7. Issue quotes under the **correct `routeId`** based on the merchant type: AI agent traffic → `agent-x402`, merchant monetisation → `merchant-aifp1`.

---

## 8. Risk Register for the Migration Itself

| Risk | Mitigation |
|---|---|
| Breaking the SDK without warning | SDK version bump to 6.0; release notes; minimum 30-day deprecation window for v1.3 endpoints |
| Removing tests that exercise integration behaviour still needed in v1.4 | Each removed test must be matched with a v1.4 equivalent (see §5.2) before deletion |
| Lost historical deployment record | Preserve `deployments/polygon-v5.3.json`, `deployments/amoy-v5.3.json` (renamed, never deleted) |
| Code removal breaks a transitive import | Phase 6 must be one commit per file with a green CI between each commit |
| Audit finds a blocker in Phase 5 | Roll back Phase 4; v1.4 does not ship; v1.3 remains the supported version |
| Production signer key compromised between Phase 4 and Phase 7 | Pre-prod revoke flow; production deploy only after key is in production KMS |
| Backend not ready when production deploy happens | Production deploy gated on backend integration test passing on Amoy |
| ADMIN_ROLE and SIGN_OPERATOR_ROLE held by same EOA at deploy | Constructor enforces `initialAdmin != initialSigner`; test confirms |
| ADMIN renounces and no new ADMIN is granted | Contract becomes ungovernable but settlements continue; documented as "Accepted — operational" in `V14_BACKEND_RISK_CLOSURE.md` |
| Profile change race confuses backend | Document the "current profile at settlement" semantics in SDK and backend; SDK does not need to react; backend reads profile before signing and after |

---

## 9. Rollback Strategy

If a Critical or High severity bug is found in v1.4 **after** production deploy:

1. **Pause v1.4.** ADMIN calls `pause()`. All settlements revert `EnforcedPause()`. Existing routes stop processing.
2. **Disable affected route(s).** ADMIN calls `disableRoute(routeId)`. Settlements using that route revert `RouteDisabled`. Other routes continue.
3. **Rotate SDK back to v1.3.** SDK 5.x still supports v1.3 endpoints. Traffic reverts to v1.3 contracts.
4. **Investigate.** Bug is reproduced on a testnet fork; fix is written, audited, deployed as v1.4.1.
5. **Migrate.** New SDK version points at v1.4.1. Old v1.4 contract is left paused or disabled; not used.

This rollback does not require a state migration because v1.4 holds no state that is not reproducible from the quote + signature pair.

---

## 10. Timeline (Indicative)

| Phase | Indicative duration | Notes |
|---|---|---|
| Phase 0 (docs) | 1 week | Current PR |
| Phase 1 (canonical docs) | 1 week | After docs review |
| Phase 2 (code + tests) | 3 weeks | Includes multi-route + RBAC + Foundry tests |
| Phase 3 (dual-mode fixtures) | 0.5 weeks | Small |
| Phase 4 (testnet deploy) | 0.5 weeks | Includes Polygonscan verification |
| Phase 5 (audit) | 2-4 weeks | External auditor; internal for non-critical changes. Audit must cover RBAC separation |
| Phase 6 (legacy removal) | 1 week | One commit per file |
| Phase 7 (production) | 1 week | Includes timelock + multisig + KMS integration |

Total: 10-13 weeks, dominated by audit.

---

## 11. Open Questions (Handed to Phase 0 Review)

1. Confirm `SIGN_OPERATOR_ROLE` is sufficient (single signer) vs. M-of-N. See `V14_ARCHITECTURE.md` §3.2.
2. Confirm `payerNonce` is global per payer, not per route. See `V14_ARCHITECTURE.md` §13.
3. Confirm `orderIdHash` is the right primitive (vs. leaving `orderId` as a `string`).
4. Confirm EIP-712 `version` starts at `"1"` and bumps only on typed-data layout change.
5. Confirm `validUntil` semantics: hard deadline (current spec) vs. soft (extendable by signer).
6. Confirm `routeTreasury` field is required in v1.4 (vs. only global `treasury`).
7. Confirm `Ownable2Step` is the right inheritance pattern for v1.4 (vs. plain `Ownable`).
8. Confirm constructor enforces `initialAdmin != initialSigner` (separation of duties).

---

— End of migration plan —