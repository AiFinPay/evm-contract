# B2BSplitter v1.4 — Splitter-Only Architecture

**Status:** implemented
**Replaces:** `B2BSplitterV13`, `AiFinPayCore v5.3`, `MSECCOToken`, `AgentPassport`
**Audience:** engineering, audit, SDK, backend
**Last updated:** 2026-08-31

---

## 1. Motivation

`CONTRACT_SDK_RISK.md` enumerates the backend risks that the v1.3 contract does **not** solve. The most damaging is risk #6: **no cryptographic signature on quote parameters**. Combined with v1.3's pre-rotation economics, this creates a class of failures that the on-chain surface cannot detect:

- Frontend or SDK manipulates `grossAmount`, `merchant`, or `validUntil` after the backend publishes a quote.
- Backend produces predictable `paymentId`s (autoincrement, hash of timestamp), letting an attacker pre-empt or DoS payments.
- The same quote is replayed on a different chain (chainId not bound into the digest).
- The same quote is replayed under a different merchant by a compromised relayer.

The v5.3 AiFinPay architecture has a second problem: it puts **business logic that does not belong on-chain** into contracts (mSECCO credits, seats, manifesto, ARP tiers). This expands attack surface, multiplies the audit surface, and forces upgrades to coordinate across multiple contracts.

The v1.3 splitter-only deployment model has a third problem: a single deployment serves exactly **one** route profile (`agent-x402` `0/0` OR `merchant-aifp1` `100/0`). Production therefore needs two deployments per chain — one per route — duplicating verification, governance, and treasury wiring.

**v1.4 design principles.**

1. Move what is not a payment-routing concern out of the contracts. Keep only what is needed to atomically split funds to merchant, treasury, and IP creator on a single chain.
2. Make every quote cryptographically bound to `(chainId, contract, params, payer, routeId, signer)` so the on-chain surface is the source of truth.
3. **One deployment, many routes.** A single contract supports both `agent-x402` and `merchant-aifp1` via per-route profile storage. Quote's `routeId` selects which profile applies at settlement time.
4. **Two-role RBAC.** `ADMIN_ROLE` for governance, `SIGN_OPERATOR_ROLE` for quote signing. The two keys have orthogonal powers — neither can do the other's job.

---

## 2. Scope Changes

### 2.1 Removed contracts

| Contract | Reason for removal | Off-chain replacement |
|---|---|---|
| `AiFinPayCore v5.3` | Business logic (seats, manifesto, ARP tiers, Pyth top-ups, daily limits, partner registry) belongs in backend + DB | Backend ledger tracks mSECCO balances, ARP tier, partner status |
| `MSECCOToken` | Internal credit token, non-transferable, exists only inside the AiFinPay product surface | Off-chain credit ledger; on-chain settlement is in USDC/USDT/native |
| `AgentPassport` | Soulbound identity NFT; KYC is the backend's responsibility | Backend maintains passport state; quote signature binds wallet to verified identity |
| `B2BSplitterV13` (single-route per deployment) | One contract serves both routes via `routeId` | n/a (replaced by v1.4) |

### 2.2 Retained / reused contracts

| Contract | Status |
|---|---|
| `B2BSplitterV14` | **New.** Splitter-only with EIP-712 quote signature, two-role RBAC, multi-route profile |
| `TokenList` | **New.** Standalone stablecoin allow-list satellite, deployed by `B2BSplitterV14` constructor |
| `Profiles` | **New.** Standalone per-route economics storage, deployed by `B2BSplitterV14` constructor |
| `Whitelist` | Reused library inside `TokenList` |
| `MockERC20` | Test-only; reused |
| `MockReverter` | Test-only; reused |
| `MockPyth` | Test-only; **drop** (no oracle integration in v1.4) |
| `TimelockWrapper` | **Reused and retained.** Bootstrap helper that deploys a 48-hour `TimelockController` and transfers `Ownable` ownership of legacy contracts. For v1.4 it is used only to deploy the `TimelockController` (see `scripts/deploy-timelock.ts`) — `B2BSplitterV14` itself is not `Ownable`, so `transferToTimelock`/`transferMultiple` are not used on it. Instead, the deployer EOA grants `ADMIN_ROLE` to the `TimelockController` via `grantRole`. `TimelockWrapper` self-destructs after deployment. Foundry tests in `TimelockTest.t.sol` are kept and rewritten to target v1.4 admin functions (`configureRoute`, `grantSignerRole`) instead of the removed v1.2 `setSplit`. |
| `TimelockController` (OZ) | Used as-is from OpenZeppelin for governance |

### 2.3 Removed runtime errors

`errors/Errors.sol` shrinks dramatically. All errors tied to Core/Passport/mSECCO/manifesto/Pyth/seats/ARP tiers are removed. New errors added for the EIP-712 quote path and the multi-route RBAC. See `V14_MIGRATION.md` §4.

---

## 3. Architecture

### 3.1 Component diagram

```
                         ┌──────────────────────────────────────────────────────┐
                         │                  B2BSplitterV14                      │
                         │       (splitter-only multi-route payment router)      │
                         │                                                      │
   Backend signer ──────┐ │   AccessControl {                                   │
   (SIGN_OPERATOR_ROLE) │ │       ADMIN_ROLE        : governance (Timelock)     │
   off-chain, ECDSA     │ │       SIGN_OPERATOR_ROLE: backend hot key (KMS)     │
   secp256k1            │ │   }                                                  │
   ─────────────────────┘│   Pausable (whenPaused)                              │
                         │                                                       │
                         │   ┌──────────┐    settle(Quote, signature)            │
                         │   │ EIP-712  │───────────────────────────┐           │
                         │   │  quote   │  ✓ ecrecover               │           │
                         │   └──────────┘  ✓ deadline                │           │
                         │                  ✓ nonce(payer)            │           │
                         │                  ✓ msg.value == quote     │           │
                         │                  ✓ profile(routeId)       │           │
                         │                  ✓ token in allow-list      │           │
                         │                  ✓ split gross → 3 legs    │           │
                         │                  ✓ mark nonce consumed    │           │
                         └───────┬───────────────┬────────────────────┘           │
                                 │               │
              route economics   │               │   stablecoin allow-list
                 (read-only)    │               │      (admin callable)
                                 ▼               ▼
                         ┌──────────┐    ┌──────────┐
                         │ Profiles │    │ TokenList│
                         └──────────┘    └──────────┘
                                 │               │
                                 └───────┬───────┘
                                         │
                         3 atomic transfers│
                                         ▼
                         ┌──────────────────────────────────────────────────────┐
                         │  Merchant     Treasury / routeTreasury    IP creator │
                         └──────────────────────────────────────────────────────┘

   Production governance bootstrap:

   Safe (4-of-4)  ──propose/execute──▶  TimelockController (48h delay)
                                             │
                                             └── grant/revoke ADMIN_ROLE ──▶ B2BSplitterV14
                                             └── grant/revoke SIGN_OPERATOR_ROLE
                                             └── pause / configureRoute / setTreasury
```

### 3.2 Roles

The contract inherits OpenZeppelin's `AccessControl` and adds two custom roles. `AccessControl` natively distinguishes between `DEFAULT_ADMIN_ROLE` (the role that can grant/revoke other roles) and the operational roles.

| Role | ID | Where | Powers |
|---|---|---|---|
| `DEFAULT_ADMIN_ROLE` (= `ADMIN_ROLE` alias) | `bytes32(0)` | TimelockController (which itself is owned by a Gnosis Safe) | Grant/revoke `ADMIN_ROLE` and `SIGN_OPERATOR_ROLE`; pause/unpause; set treasury; manage stablecoin whitelist; configure/disable routes; renounce role (in emergency) |
| `SIGN_OPERATOR_ROLE` | `keccak256("SIGN_OPERATOR_ROLE")` | Backend hot key (separate from admin, held in KMS) | Sign quotes only — no admin functions, no pause, no role management |

`ADMIN_ROLE` (held by `TimelockController`) and `SIGN_OPERATOR_ROLE` (held by the backend KMS key) are **deliberately orthogonal**:

- A compromised admin **cannot forge quotes** (admin has no signing key).
- A compromised signer **cannot drain funds, pause, change treasury, or change routes** (signer has no admin powers).

The `DEFAULT_ADMIN_ROLE` is the role that grants/revokes `SIGN_OPERATOR_ROLE`. During signer rotation the admin role holds both keys briefly; see §7.2.

### 3.3 Storage layout

`B2BSplitterV14` owns two satellite contracts deployed in its constructor. Their storage is separate, but the splitter holds their addresses and is their `DEFAULT_ADMIN_ROLE`.

```
B2BSplitterV14
  Pausable                 _paused
  AccessControl            ADMIN_ROLE, SIGN_OPERATOR_ROLE, role memberships

  EIP-712                  bytes32 _CACHED_DOMAIN_SEPARATOR
                           uint256 _CACHED_CHAIN_ID
                           address _CACHED_THIS
                           bytes32 _HASHED_NAME, _HASHED_VERSION
                           bytes32 _QUOTE_TYPEHASH

  State                    address treasury              (mutable by ADMIN_ROLE)
                           ITokenList tokenList          (immutable reference)
                           IProfiles  profiles           (immutable reference)

  Replay protection        mapping(address => uint256) payerNonce
                           mapping(address => mapping(uint256 => bool)) consumedNonce

TokenList (satellite)
  AccessControl            DEFAULT_ADMIN_ROLE == B2BSplitterV14
  Whitelist library        mapping(address => bool) whitelistedTokens

Profiles (satellite)
  AccessControl            DEFAULT_ADMIN_ROLE == B2BSplitterV14
  State                    mapping(bytes32 routeId => RouteProfile) profiles
                           bytes32[] routeIds
                           struct RouteProfile {
                               uint16 treasuryBps;      // 0..500
                               uint16 ipCreatorBps;     // 0..100
                               bool   enabled;
                               uint64 configuredAt;     // block.timestamp
                               address routeTreasury;   // 0x0 means use treasury
                           }
```

The splitter holds references to `TokenList` and `Profiles`, but those satellites are stateless from the splitter's perspective: no reentrancy path exists because they do not call back into the splitter.

The `RouteProfile.routeTreasury` field is optional: by default, every profile routes fees to `treasury` (the global treasury). A profile may override with a route-specific treasury (e.g. a partner's fee wallet that batches into the Safe). This keeps one Safe as the global treasury but allows route-level fee splitting if needed.

---

## 4. Multi-Route Profile Model

v1.4 replaces v1.3's `immutable treasuryBps/ipCreatorBps` + `_validateProductionSplit` closed-set model with a **per-route profile mapping** that ADMIN can configure.

### 4.1 Built-in routes

Two routes are configured at construction and remain the canonical production economics:

| `routeId` | Name | `treasuryBps` | `ipCreatorBps` |
|---|---|---|---|
| `keccak256("agent-x402")` | `agent-x402` (AIFP-2/x402 agent flow) | `0` | `0` |
| `keccak256("merchant-aifp1")` | `merchant-aifp1` (AIFP-1 merchant monetisation) | `100` | `0` |

`routeId = keccak256(bytes(routeName))`. The byte representation is fixed and known to backend, SDK, frontend, and contract. Both routes are configured at construction with `enabled = true`.

### 4.2 Initial constructor

```solidity
constructor(ConstructorParams memory _params) EIP712(EIP712_NAME, EIP712_VERSION) {
    if (_params.initialAdmin == address(0)) revert ZeroAdmin();
    if (_params.initialSigner == address(0)) revert ZeroSigner();
    if (_params.initialAdmin == _params.initialSigner) revert AdminEqualsSigner();
    if (_params.treasury == address(0)) revert ZeroTreasury();

    _grantRole(ADMIN_ROLE, _params.initialAdmin);
    _grantRole(SIGN_OPERATOR_ROLE, _params.initialSigner);

    treasury = _params.treasury;

    tokenList = ITokenList(address(new TokenList(address(this), _params.stablecoins)));
    profiles = IProfiles(
        address(new Profiles(address(this), _params.routeIds, _params.treasuryBps, _params.ipCreatorBps))
    );
}
```

The constructor enforces:
- `initialAdmin != address(0)` and `initialAdmin != initialSigner` (`AdminEqualsSigner`) — separation of duties from byte one.
- `treasury != address(0)` (`ZeroTreasury`).
- `TokenList` rejects empty `_stablecoins` and zero addresses.
- `Profiles` validates per-route caps (`TreasuryFeeTooHigh`, `IPCreatorFeeTooHigh`) and array length equality.

There is **no `Ownable`** in v1.4. Governance is pure `AccessControl`.

### 4.3 Per-route configuration

```solidity
function configureRoute(
    bytes32 _routeId,
    uint16 _treasuryBps,
    uint16 _ipCreatorBps,
    address _routeTreasury          // optional override; address(0) = use global treasury
) external onlyRole(ADMIN_ROLE);

function disableRoute(bytes32 _routeId) external onlyRole(ADMIN_ROLE);
function enableRoute(bytes32 _routeId) external onlyRole(ADMIN_ROLE);
```

`configureRoute` delegates to `Profiles.configureRoute`, which enforces `_treasuryBps <= MAX_TREASURY_BPS` and `_ipCreatorBps <= MAX_IP_CREATOR_BPS`. The route becomes the new `treasuryBps`/`ipCreatorBps` for that route **immediately**. In-flight quotes that already carry the old `routeId` digest use the **current** profile at settlement time — see §5.4.

ADMIN can rotate profiles but cannot **remove** a routeId from the contract. A routeId, once added, exists forever; ADMIN can only toggle `enabled`. This guarantees quote digests remain verifiable across the contract lifetime.

### 4.4 What is still immutable

- `MAX_TREASURY_BPS = 500`, `MAX_IP_CREATOR_BPS = 100` (security ceiling; hardcoded).
- The routeId set is monotonic — once a `bytes32` is configured as a route, it stays.
- The two built-in route names (`agent-x402`, `merchant-aifp1`) are protocol-defined identifiers; ADMIN can change their **profile** but cannot change the routeId.
- Owner powers (`pause`, `setTreasury`, `setWhitelistedTokens`) are gated to `ADMIN_ROLE`. There is no `Ownable` owner: governance is pure `AccessControl`.

What is **mutable**: per-route `treasuryBps`, `ipCreatorBps`, `enabled` flag, `routeTreasury` override, plus global `treasury` and the `TokenList` allow-list. ADMIN can adjust economics within the security ceiling. This is a deliberate change from v1.3 (where everything was immutable) — the trade-off is documented in §9.

---

## 5. Quote Lifecycle

A quote is an EIP-712 typed struct signed by a `SIGN_OPERATOR_ROLE` holder. The full format is in `V14_QUOTE_FORMAT.md`. Summary:

```
Quote {
    payer:       address
    merchant:    address
    token:       address(0) | USDC | USDT
    grossAmount: uint256
    ipCreator:   address(0) if route has no creator leg, else required
    validUntil:  uint256        // block.timestamp upper bound
    orderIdHash: bytes32        // keccak256(string orderId), 32 bytes
    nonce:       uint256        // per-payer monotonic, assigned by backend
    routeId:     bytes32        // keccak256("agent-x402" | "merchant-aifp1")
}

digest = EIP712_HASH(DOMAIN_SEPARATOR, QUOTE_TYPEHASH, Quote)
signature = secp256k1 sign(digest) by SIGN_OPERATOR_ROLE
```

### 5.1 Sequence

```
Backend                                       Payer                           Contract
   │                                             │                                 │
   │  1. POST /quote {payer, routeId, amount}  │                                 │
   │◄────────────────────────────────────────────│                                 │
   │                                             │                                 │
   │  2. validate payer is verified, KYC'd,     │                                 │
   │     check route economics, assign nonce,   │                                 │
   │     compute quote hash, sign.              │                                 │
   │                                             │                                 │
   │  3. return {quote, signature}  ─────────────►│                                 │
   │                                             │  4. settle(quote, signature)    │
   │                                             │     with msg.value (if native)  │
   │                                             │     or approve (if stable)      │
   │                                             │────────────────────────────────►│
   │                                             │                                 │
   │                                             │     5. ecrecover → signer       │
   │                                             │        hasRole(SIGN_OPERATOR)   │
   │                                             │        check deadline           │
   │                                             │        check payerNonce         │
   │                                             │        check msg.value==gross   │
   │                                             │        check route enabled      │
   │                                             │        check token in whitelist │
   │                                             │        mark nonce consumed      │
   │                                             │        split + transfer         │
   │                                             │                                 │
   │                                             │  6. emit Payment(...)          │
   │                                             │◄────────────────────────────────│
```

### 5.2 Replay protection

| Attack | Defense |
|---|---|
| Replay same `quote, signature` on the same contract | `mapping(payer => mapping(nonce => bool)) consumedNonce` is set to `true` before any external call |
| Replay same `nonce` with a different `merchant` | The signature covers `merchant`; `ecrecover` will reject |
| Replay same `quote, signature` on another chain | `DOMAIN_SEPARATOR` includes `chainId`; `ecrecover` will reject |
| Replay same `quote, signature` on another splitter at the same chain | `DOMAIN_SEPARATOR` includes `address(this)`; `ecrecover` will reject |
| Replay same `quote, signature` on a fork | `DOMAIN_SEPARATOR` includes `chainId` and `address(this)`; ECDSA-only signatures do not have replay across forks unless the EIP-712 domain is the same |
| Skip ahead to a future `nonce` | `nonce` must equal `payerNonce[payer]` exactly; future nonces are rejected |
| Use the same nonce twice | `consumedNonce[payer][nonce]` reverts with `NonceAlreadyConsumed` |
| Replay across routes | `routeId` is part of the digest; same nonce under a different `routeId` produces a different digest, so the original signature does not validate |

### 5.3 Deadline protection

| Surface | Window | Rationale |
|---|---|---|
| Backend issuance | quote has `validUntil <= now + 1h` (configurable per route) | Limit damage from leaked signatures |
| Contract enforcement | `block.timestamp <= validUntil` else revert `SignatureExpired` | On-chain guarantees expiry |

The contract cannot choose the deadline — the signer chooses it. This is intentional: the signer is the trust anchor for what is still a valid offer.

### 5.4 Profile-change race window

If ADMIN changes a route's `treasuryBps` mid-flight:

| Quote state | Behavior |
|---|---|
| Quote not yet signed | Backend reads new profile; signs with new profile economics if appropriate |
| Quote signed and in mempool | Settles using **old** profile (digest carries the implied profile by routeId; contract reads current profile at settlement — see decision below) |
| Quote settled | Settlement uses the **profile current at settlement time**, not the profile current at signature time |

The design choice is "current profile at settlement". This means a quote with `routeId = merchant-aifp1` always settles with whatever `merchant-aifp1` profile is configured at the moment of `settleStable()`/`settleNative()` call, regardless of when the quote was signed. Implication: ADMIN's profile changes take effect at the next settlement, not at the next quote issuance. This is the simplest semantic and matches user expectation that "what you see is what you get".

If ADMIN wants to **lock** economics between signing and settlement, the model can be extended later: include `treasuryBps` and `ipCreatorBps` in the quote digest. This is **out of scope for v1.4** and tracked in `V14_FUTURE.md`.

---

## 6. Settlement Path

### 6.1 Native (`settleNative(Quote, bytes signature)`)

```solidity
function settleNative(Quote calldata _quote, bytes calldata _signature)
    external payable nonReentrant whenNotPaused
{
    IProfiles.RouteProfile memory profile = _verifyQuote(_quote, _signature);
    if (_quote.token != address(0)) revert InvalidTokenForNative();
    if (msg.value != _quote.grossAmount) revert IncorrectNativeValue(_quote.grossAmount, msg.value);

    (uint256 merchantAmt, uint256 treasuryAmt, uint256 ipAmt) =
        _splitGross(_quote.grossAmount, profile, _quote.ipCreator);

    address routeTreasury = profile.routeTreasury == address(0) ? treasury : profile.routeTreasury;

    (bool s1,) = payable(_quote.merchant).call{value: merchantAmt}("");
    if (!s1) revert MerchantTransferFailed();

    if (treasuryAmt > 0) {
        (bool s2,) = payable(routeTreasury).call{value: treasuryAmt}("");
        if (!s2) revert TreasuryTransferFailed();
    }
    if (ipAmt > 0) {
        (bool s3,) = payable(_quote.ipCreator).call{value: ipAmt}("");
        if (!s3) revert IPCreatorTransferFailed();
    }

    _emitPayment(_quote, merchantAmt, treasuryAmt, ipAmt);
}
```

### 6.2 Stable (`settleStable(Quote, bytes signature)`)

Same checks; ERC-20 path uses `safeTransferFrom` with `msg.sender` (the payer). Approval race is bounded because the payer has already approved before calling; if approval is removed between approve and call, `SafeERC20` reverts and the nonce is not consumed (atomic rollback).

### 6.3 Pure view

`quoteHash(Quote)` is exposed as a pure function so backend, SDK, and frontend can all compute the same digest without calling the contract.

### 6.4 Quote verification

```solidity
function _verifyQuote(Quote calldata _quote, bytes calldata _signature)
    internal returns (IProfiles.RouteProfile memory profile)
{
    if (_signature.length != 65) revert InvalidSignatureLength();
    address recovered = ECDSA.recover(digest(_quote), _signature);
    if (recovered == address(0)) revert InvalidSignature();
    if (!hasRole(SIGN_OPERATOR_ROLE, recovered)) revert InvalidSigner();

    if (block.timestamp > _quote.validUntil) revert SignatureExpired(_quote.validUntil, block.timestamp);
    if (_quote.payer == address(0) || _quote.payer != msg.sender) revert InvalidPayer();
    if (_quote.merchant == address(0)) revert ZeroMerchant();

    profile = profiles.getProfile(_quote.routeId);
    if (!profile.enabled) revert RouteDisabled(_quote.routeId);

    if (_quote.nonce != payerNonce[_quote.payer]) revert InvalidNonce();
    if (consumedNonce[_quote.payer][_quote.nonce]) revert NonceAlreadyConsumed();

    uint256 nextNonce;
    unchecked { nextNonce = _quote.nonce + 1; }
    if (nextNonce < _quote.nonce) revert NonceOverflow();

    payerNonce[_quote.payer] = nextNonce;
    consumedNonce[_quote.payer][_quote.nonce] = true;
}
```

`_verifyQuote` recovers the signer, validates role/deadline/payer/merchant/route, and marks the nonce consumed **before** any external call (CEI ordering). If any external transfer reverts, the whole transaction rolls back and the nonce is not consumed.

---

## 7. Governance

### 7.1 ADMIN powers (`onlyRole(ADMIN_ROLE)`)

```solidity
function pause() external onlyRole(ADMIN_ROLE)
function unpause() external onlyRole(ADMIN_ROLE)
function setTreasury(address _treasury) external onlyRole(ADMIN_ROLE)
function setWhitelistedTokens(address[] calldata, bool[] calldata) external onlyRole(ADMIN_ROLE)
function configureRoute(bytes32, uint16, uint16, address) external onlyRole(ADMIN_ROLE)
function disableRoute(bytes32) external onlyRole(ADMIN_ROLE)
function enableRoute(bytes32) external onlyRole(ADMIN_ROLE)
function grantSignerRole(address) external onlyRole(ADMIN_ROLE)
function revokeSignerRole(address) external onlyRole(ADMIN_ROLE)
```

There is **no** `Ownable`/`Ownable2Step` in v1.4. Governance is pure `AccessControl`. ADMIN transfer is performed by granting `ADMIN_ROLE` to the new governor and (optionally) revoking it from the old one. The TimelockController becomes `ADMIN_ROLE` holder in production.

All ADMIN actions are gated by the timelock + multisig governance layer:

- On testnet: deployer EOA is `ADMIN_ROLE`.
- On production: the deploy script runs `scripts/deploy-timelock.ts`, which deploys `TimelockWrapper` (which deploys a `TimelockController` with 48-hour delay). Then `B2BSplitterV14` is deployed with the deployer EOA as `ADMIN_ROLE`. The Safe schedules `TimelockController` proposals to (a) `grantRole(DEFAULT_ADMIN_ROLE, timelock)` on `B2BSplitterV14` and (b) `revokeRole(DEFAULT_ADMIN_ROLE, deployer)` from `B2BSplitterV14`. After the 48-hour delay governance becomes Safe → `TimelockController` → splitter. The `SIGN_OPERATOR_ROLE` is granted in a separate proposal. `TimelockWrapper` self-destructs after the bootstrap; `B2BSplitterV14` holds the canonical admin address via `getRoleAdmin` / `hasRole`.

### 7.2 Signer rotation

`grantSignerRole(newSigner)` and `revokeSignerRole(oldSigner)` are `onlyRole(ADMIN_ROLE)`. Production rotation must:

1. Generate the new signer key in KMS.
2. Schedule a `TimelockController` proposal that calls `grantSignerRole(newSigner)` with `ADMIN_ROLE = TimelockController`.
3. After the 48-hour delay, execute the proposal — `hasRole(SIGN_OPERATOR_ROLE, newSigner)` flips to true.
4. Update backend to use the new key.
5. After 24 hours of stable operation, schedule a second proposal to `revokeSignerRole(oldSigner)`.
6. After the second 48-hour delay, execute; the old key loses signing authority.

The `ADMIN_ROLE` (held by `TimelockController`) must hold both signer keys during the rotation window. There is no way to add a third key for rotation; ADMIN uses the existing `SIGN_OPERATOR_ROLE` grant list to manage membership.

In the rotation window (between Step 3 and Step 6, ~24 hours), both keys can sign. This is intentional: it allows emergency rollback if the new key fails. The window is bounded.

### 7.3 Pause semantics

  Pause stops **settlement**, not admin actions. The ADMIN can still rotate signers, configure routes, and update the treasury while the contract is paused, ensuring that a compromised signer does not also lock governance.

### 7.4 ADMIN_ROLE transfer

v1.4 deliberately does **not** use `Ownable` or `Ownable2Step`. Governance is pure `AccessControl`. Transferring the admin authority is done by role grant/revoke:

1. Current `ADMIN_ROLE` holder schedules a `TimelockController` proposal to grant `ADMIN_ROLE` to the new governor (e.g. a new TimelockController or Safe).
2. After the 48-hour delay, execute the proposal.
3. Optionally schedule a second proposal to revoke `ADMIN_ROLE` from the old governor after the new one is confirmed.

This is a two-step process at the governance layer (Timelock + Safe), not in the contract. There is no `owner()` getter. If all `ADMIN_ROLE` holders are lost, the contract becomes ungovernable but settlements continue — recoverable only by a signer-controlled `governanceRecovery()` if implemented in a future version (out of v1.4 scope, tracked in `V14_FUTURE.md`).

### 7.5 Role renunciation

`ADMIN_ROLE` and `SIGN_OPERATOR_ROLE` holders may call `renounceRole(role, account)` to give up their role. This is intentional in case an emergency requires ADMIN to step down (e.g. suspected compromise). The ADMIN can renounce their own role, which freezes governance until a new ADMIN is granted via the existing ADMIN_ROLE.

In v1.4 the contract is **safe under zero ADMINs** because signers can still settle quotes (they don't need ADMIN). The contract becomes **ungovernable** until a new ADMIN is granted, but settlements continue. This is acceptable: better to keep paying merchants than to halt the protocol during a crisis.

---

## 8. Failure Modes and Recovery

| Failure | Behavior | Recovery |
|---|---|---|
| Backend signer key leaked | Attacker can forge quotes for any `payer` they have an approval from | `revokeSignerRole(attacker)` via timelock; `pause()` to halt settlements during rotation |
| Backend signer key lost | No new quotes can be issued | `grantSignerRole(newSigner)` via timelock; no fund loss |
| ADMIN_ROLE lost (e.g. all admins renounced or key lost) | No governance actions possible, but settlements continue | Recovery requires a new ADMIN_ROLE grant from the existing ADMIN_ROLE — circular. Recovery path is documented in `V14_FUTURE.md` as a future feature |
| `nonce` out of sync between backend and contract | Settlement reverts with `InvalidNonce` | Backend re-fetches `payerNonce(payer)` from the contract and rebuilds the quote |
| Payer tries to settle an expired quote | Revert `SignatureExpired` | Payer requests a new quote from the backend |
| Payer tries to settle with wrong `msg.value` | Revert `IncorrectNativeValue` | Payer retries with the exact amount from the quote |
| Payer tries to settle with a wrong token | Revert `UnsupportedToken` | Payer switches to the token in the quote |
| Merchant address reverts on receive | Whole tx reverts; `consumedNonce` is **not** incremented (CEI) | Payer retries; quote is still valid |
| Treasury / route treasury reverts | Whole tx reverts; same | Payer retries |
| ADMIN disables a route mid-flight | Settlements using that `routeId` revert `RouteDisabled` | Payer requests a quote under a different `routeId` |
| ADMIN changes route profile mid-flight | Settlements use the **new** profile (see §5.4) | Payer was shown the price before signing; trust the UX |
| Storage growth from `consumedNonce` | Linear with settlement count | Optional: TTL purge (out of v1.4 scope; tracked in `V14_FUTURE.md`) |
| Wrong chainId in cross-chain replay | `ecrecover` fails | (Defensive only — there is no on-chain recovery if the contract is on the wrong chain) |

---

## 9. What v1.4 Does Not Solve

Documented honestly so future work is scoped correctly:

1. **Fee-on-transfer tokens.** Whitelisted tokens are assumed clean. If a token is added with a transfer fee, the merchant receives less than the event emits. v1.4 inherits this from v1.3 — operational governance (timelock + multisig) is the defense. See `AUDIT_B2BSplitterV13.md` `[R-M-01]`.
2. **Storage growth.** `consumedNonce` is monotonic per payer. For high-throughput agents, this is a long-term concern. Out of scope for v1.4.
3. **Quote-bound profile.** A quote with `routeId = merchant-aifp1` settles with the profile current at settlement time, not signature time. If ADMIN changes the profile between signing and settlement, the user pays the new economics. Mitigation: ADMIN should not change profiles frequently; communicate profile changes to backend before they happen. Future v1.4.x: bind profile to digest.
4. **Backend key management.** The signer key is a hot key by necessity (it must sign on user request). Hardware-backed signing (AWS KMS, GCP KMS, Fireblocks) is recommended. Out of scope for the contract.
5. **ADMIN_ROLE recovery.** If all ADMINs are lost, governance freezes. Future v1.4.x: implement `governanceRecovery(address newAdmin)` gated by the union of `ADMIN_ROLE` and `SIGN_OPERATOR_ROLE`.

---

## 10. Comparison Table

| Property | v5.3 (AiFinPayCore) | v1.3 (B2BSplitter) | v1.4 (splitter-only, signed, multi-route, RBAC) |
|---|---|---|---|
| Number of contracts | 4 (Core, Passport, mSECCO, Splitter) | 1 per route | **1 contract serves both routes** |
| Routes per contract | 1 (configurable) | 1 (`immutable`) | N (ADMIN-configurable, capped by `MAX_*_BPS`) |
| Quote integrity | None (caller-controlled) | None (caller-controlled) | EIP-712 by `SIGN_OPERATOR_ROLE` |
| Replay protection | `consumedPayment[bytes32]` | `consumedPayment[bytes32]` | `consumedNonce[payer][uint256]` |
| Cross-chain replay | Possible if same `paymentId` | Possible if same `paymentId` | Impossible (chainId + address in domain) |
| Same-id cross-route | Possible | Possible | Impossible (routeId in digest) |
| Economic mutability | `setFees` allowed | `immutable` | Per-route `configureRoute` (capped by `MAX_*_BPS`) |
| RBAC roles | `Ownable` (single owner) | `Ownable` (single owner) | `AccessControl` only (ADMIN + SIGN_OPERATOR) |
| Pause | `isPaused` flag | OZ `Pausable` | OZ `Pausable` (orthogonal to sign) |
| Backend key separation | n/a | n/a | Yes — signer ≠ admin |
| Attack surface | ~1200 LoC | 331 LoC | ~600 LoC (estimated, multi-route) |
| Audit cost | High (4 contracts) | Low (1 contract) | Low (1 contract) |
| Pyth oracle integration | Yes | No | No (removed) |
| Daily spend limits | Yes (passport) | No | No (moved to backend) |
| Seats / manifesto | Yes | No | No (moved to backend) |

---

## 11. Risk Closure Matrix

| Backend risk from `CONTRACT_SDK_RISK.md` | v1.3 status | v1.4 status |
|---|---|---|
| #1 Predictable `paymentId` | Not solved | **Solved** — `nonce` is per-payer monotonic; backend must assign sequentially from on-chain state |
| #2 `validUntil` infinite | Contract enforces non-zero + `block.timestamp > validUntil` | Contract enforces; signer enforces sane issuance windows |
| #3 `grossAmount != msg.value` | Contract reverts `IncorrectNativeValue` | Same; **additionally** the quote digest binds `grossAmount`, so the SDK cannot show a different amount |
| #4 Merchant address validation | `address(0)` only | Same; **additionally** the quote is signed, so the merchant cannot be silently swapped after the user sees it |
| #5 `orderId` uniqueness | Not on-chain (only emitted) | `orderIdHash` is part of the quote digest; backend can hash off-chain `orderId` and the SDK verifies |
| #6 No signature on quote | **Major gap** | **Closed** — EIP-712 signature by `SIGN_OPERATOR_ROLE` |
| #7 Cross-chain replay | Not solved | **Closed** — `chainId` in `DOMAIN_SEPARATOR` |
| #8 Cross-contract replay | n/a | **Closed** — `address(this)` in `DOMAIN_SEPARATOR` |
| #9 ADMIN key compromise drains signer | n/a | **Closed** — orthogonal roles; admin has no signing key |
| #10 Signer key compromise drains admin | n/a | **Closed** — signer cannot pause, change treasury, change whitelist, or change routes |

Full risk matrix in `V14_BACKEND_RISK_CLOSURE.md`.

---

## 12. Implementation Status

This architecture is now implemented. The migration status is tracked in `V14_MIGRATION.md`:

- ✅ `B2BSplitterV14.sol`, `TokenList.sol`, `Profiles.sol`, interfaces, and errors implemented.
- ✅ Hardhat unit tests for native, stable, signature, RBAC, and route management.
- ✅ Deploy scripts (`deploy-splitter-v14.ts`, `deploy-splitter-v14-production.ts`) and production config (`v14-production-config.ts`).
- ✅ `TimelockWrapper.sol` retained as the bootstrap helper for `TimelockController`.
- ⏳ Foundry invariant tests for `_splitGross`, ECDSA, `consumedNonce` monotonicity, RBAC separation.
- ⏳ Independent re-audit and `AUDIT_B2BSplitTERV14.md`.
- ⏳ SDK/backend integration to compute EIP-712 digest and submit `settleNative` / `settleStable`.

---

## 13. Decisions / Open Questions

Resolved decisions are recorded here; remaining open work is tracked in `V14_FUTURE.md`.

1. ✅ `routeTreasury` (per-route treasury override) **kept** for forward compatibility; default `address(0)` = use global treasury.
2. ✅ `payerNonce` is **globally monotonic per payer**, not per-route.
3. ✅ `consumedNonce(payer, nonce)` is a **public mapping** (free with `mapping` declaration).
4. ✅ `configureRoute` is gated by `ADMIN_ROLE` only; in production `ADMIN_ROLE` is the `TimelockController`, so the 48-hour delay applies automatically.
5. ✅ Historical `SIGN_OPERATOR_ROLE` members are tracked via `RoleGranted` / `RoleRevoked` events only; no on-chain list.
6. ⏳ Profile-bound digest (freeze economics at signing time) — deferred to v1.4.x. See `V14_FUTURE.md`.
7. ⏳ Governance recovery after lost `ADMIN_ROLE` — deferred to v1.4.x. See `V14_FUTURE.md`.
8. ⏳ Storage pruning / TTL for `consumedNonce` — deferred. See `V14_FUTURE.md`.

---

— End of design spec —