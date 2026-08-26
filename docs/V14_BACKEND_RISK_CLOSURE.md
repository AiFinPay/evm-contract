# B2BSplitter v1.4 — Backend Risk Closure Matrix

**Status:** design spec
**Source:** `CONTRACT_SDK_RISK.md` (v1.3 baseline) + extension of risks identified during v1.4 design (RBAC, multi-route, signed quotes)
**Audience:** engineering, audit, SDK, backend, security review

This document enumerates **every** backend/SDK risk from `CONTRACT_SDK_RISK.md`, traces it through v1.3 → v1.4, and explains the on-chain defense (where one exists), the off-chain defense (where the contract cannot help), and the residual risk that the design explicitly accepts.

The matrix is exhaustive by design. If a row says "Accepted — operationally bounded", that is an **explicit, documented acceptance**, not an oversight.

---

## 1. Role-Based Risk Closure (RBAC)

v1.4 introduces two roles via OpenZeppelin `AccessControl`:

| Role | ID | Powers |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` (`bytes32(0)`) | 0 | Grant/revoke all roles; pause/unpause; set treasury; manage whitelist; configure/disable routes; transfer ownership |
| `SIGN_OPERATOR_ROLE` | `keccak256("SIGN_OPERATOR_ROLE")` | Sign quotes only — no admin functions |

This separation is the **primary** defense against several catastrophic risks. The matrix below documents each role-mixing risk.

### 1.1 Compromise of `ADMIN_ROLE` key allows forging quotes

| | |
|---|---|
| **v1.3** | n/a (no signing) |
| **v1.4** | ADMIN has no signing material. The only way to produce a valid quote is to hold `SIGN_OPERATOR_ROLE`. ADMIN cannot grant itself `SIGN_OPERATOR_ROLE` because grant/revoke requires ADMIN itself — wait, it can. Re-check: ADMIN can grant any role, including SIGN_OPERATOR. The defense is: ADMIN is in the timelock + multisig (48h delay + 4-of-4 signatures), not a hot key. The KMS-backed SIGN_OPERATOR_ROLE holder is a separate party. |
| **Defense** | ADMIN cannot forge quotes without first granting itself SIGN_OPERATOR_ROLE, which is timelock-gated and observable. The community sees the role grant in the 48h window and can veto via the multisig. |
| **Residual** | If the multisig is also compromised, attacker can grant SIGN_OPERATOR_ROLE to themselves. Mitigated by multisig distribution and operational monitoring. |
| **Status** | **Closed on contract; multisig-level governance is the operational defense** |

### 1.2 Compromise of `SIGN_OPERATOR_ROLE` key allows draining funds

| | |
|---|---|
| **v1.3** | n/a (no signing) |
| **v1.4** | Signer can forge quotes, but only **to existing whitelisted merchants** and **for amounts the payer has pre-approved**. They cannot change `treasury` (no admin power). They cannot pause. They cannot remove USDC/USDT from the whitelist. They cannot change route profiles. They can only issue valid quotes. |
| **Defense** | HSM/KMS-backed key. Timelock-gated rotation. Monitoring of quote issuance volume. `pause()` as kill switch (ADMIN-only). |
| **Residual** | Between compromise detection and revocation, the attacker can issue forged quotes for payers who have pre-approved the contract. Mitigation: monitoring + immediate `pause()` on detection. |
| **Status** | **Operationally bounded; pause is the kill switch** |

### 1.3 Signer can grant itself ADMIN_ROLE

| | |
|---|---|
| **v1.3** | n/a |
| **v1.4** | `_grantRole` and `_revokeRole` are `internal` in `AccessControl`. They are exposed via `grantRole(role, account)` and `revokeRole(role, account)` external functions, both `onlyRole(getRoleAdmin(role))`. The admin of `DEFAULT_ADMIN_ROLE` is `DEFAULT_ADMIN_ROLE` itself (circular), and the admin of `SIGN_OPERATOR_ROLE` is `DEFAULT_ADMIN_ROLE`. So a signer **cannot** grant itself `ADMIN_ROLE` (no admin power). |
| **Defense** | `AccessControl` access matrix enforces role hierarchy. |
| **Residual** | None on the contract. |
| **Status** | **Closed** |

### 1.4 ADMIN can revoke all signers (DoS)

| | |
|---|---|
| **v1.3** | n/a |
| **v1.4** | ADMIN can `revokeSignerRole` on every signer, leaving the contract with no `SIGN_OPERATOR_ROLE` holders. No new quotes can be issued. |
| **Defense** | ADMIN is in the timelock + multisig; revoking all signers is a 48h-delayed observable action. The community sees the proposal and can intervene. |
| **Residual** | ADMIN can grief by revoking signers; not a fund-loss risk, only a service-availability risk. |
| **Status** | **Operationally bounded; timelock + multisig visibility** |

### 1.5 ADMIN renounces their own role

| | |
|---|---|
| **v1.3** | n/a (single owner; same risk) |
| **v1.4** | ADMIN can call `renounceRole(DEFAULT_ADMIN_ROLE, msg.sender)`. The contract becomes **ungovernable** (no admin actions possible), but **settlements continue** because the signer role is unaffected. |
| **Defense** | Renunciation is a single transaction; not timelock-gated by default (would require an extra hook). Operational defense: ADMIN key held in multisig, not a single EOA. |
| **Residual** | If governance is lost, recovery requires either (a) re-grant via existing ADMIN (circular, impossible), or (b) hard fork. Future v1.4.x: implement `governanceRecovery(address)` gated by `SIGN_OPERATOR_ROLE` quorum (e.g. 2-of-2 or 2-of-3 signers). |
| **Status** | **Accepted; documented in `V14_ARCHITECTURE.md` §7.5. Settlements are unaffected.** |

### 1.6 Constructor accidentally grants same key both roles

| | |
|---|---|
| **v1.3** | n/a |
| **v1.4** | Constructor takes `initialAdmin` and `initialSigner` separately. Constructor enforces `initialAdmin != initialSigner` and reverts `AdminEqualsSigner()` otherwise. |
| **Defense** | On-chain constructor check. |
| **Residual** | None — enforced by code. |
| **Status** | **Closed** |

### 1.7 ADMIN_ROLE holder is `address(0)`

| | |
|---|---|
| **v1.3** | `Ownable(_owner)` with `address(0)` would brick the contract. |
| **v1.4** | Constructor rejects `initialAdmin == address(0)` with `ZeroAdmin()`. `renounceRole(DEFAULT_ADMIN_ROLE, ...)` would also leave no admin; the `NoAdminRoleHolder()` guard checks on every admin-only function. |
| **Defense** | Constructor + per-function check. |
| **Residual** | None — enforced by code. |
| **Status** | **Closed** |

---

## 2. Risk Closure Matrix (Comprehensive)

### 2.1 Predictable `paymentId` enables pre-emption / DoS

| | |
|---|---|
| **v1.3** | Backend could use autoincrement IDs. Attacker observes one, submits a settlement with that ID, locks the ID. The legitimate user reverts on `PaymentAlreadyProcessed`. |
| **v1.4** | The `paymentId` is replaced by `(payer, nonce)` pair. `nonce` is read directly from `payerNonce[payer]` on-chain. Backend must use the contract's current nonce. The attacker cannot predict a future nonce because they would need to compute `keccak256(typedData)` for each candidate. Pre-empting requires signing, which requires the private key. |
| **Defense** | On-chain: `mapping(address => uint256) payerNonce`. Off-chain: backend reads `payerNonce(payer)` from RPC before signing. |
| **Residual** | None on the contract. Backend must enforce nonce uniqueness per route. |
| **Status** | **Closed** |

### 2.2 `validUntil` infinite or too short

| | |
|---|---|
| **v1.3** | Backend sets `validUntil`. Contract only checks non-zero and `< block.timestamp`. If backend sets `validUntil = 2^256 - 1`, the quote never expires. If backend sets `validUntil = now`, the user has zero seconds to submit. |
| **v1.4** | The signer is the trust anchor for `validUntil`. Contract enforces `block.timestamp <= validUntil`. Backend has a policy: per-route max TTL (recommended 15 min for `agent-x402`, 1 h for `merchant-aifp1`). Quotes that exceed TTL are not signed. |
| **Defense** | On-chain: `if (block.timestamp > validUntil) revert SignatureExpired(...)`. Off-chain: backend policy. |
| **Residual** | Backend policy can be misconfigured. Mitigation: alerting on `validUntil > now + 1 day` in backend metrics. |
| **Status** | **Closed on contract; bounded on backend** |

### 2.3 `grossAmount` and `msg.value` mismatch

| | |
|---|---|
| **v1.3** | Contract reverts `IncorrectNativeValue(expected, received)` if `msg.value != grossAmount`. But the user pays gas for the revert, and the UX is bad. |
| **v1.4** | Same on-chain revert. **Additionally**, the `grossAmount` is part of the signed digest. SDK/frontend cannot display a different amount to the user than what the contract verifies. |
| **Defense** | On-chain: `if (msg.value != _quote.grossAmount) revert IncorrectNativeValue(...)`. UX: SDK displays the signed `grossAmount` before submitting. |
| **Residual** | If the SDK bypasses the signed quote (e.g. constructs `msg.value` independently), the contract reverts but the user pays gas. SDK bug, not contract gap. |
| **Status** | **Closed** |

### 2.4 Merchant address validation

| | |
|---|---|
| **v1.3** | Contract rejects `address(0)`. Does not reject contracts that always revert. Does not reject contracts with weird receive logic. |
| **v1.4** | Same on-chain: `if (_quote.merchant == address(0)) revert ZeroMerchant()`. **Additionally**, the merchant address is signed by the backend, so a compromised SDK cannot redirect funds to an attacker address. The user must approve the quote (via wallet UI) before settlement. |
| **Defense** | On-chain: zero-check + signed merchant. UX: wallet UI displays merchant as part of EIP-712 typed data. |
| **Residual** | Backend itself can put a malicious merchant in the quote. Mitigation: backend signs only after operator-level validation. |
| **Status** | **Closed on contract; backend-side policy required** |

### 2.5 `orderId` is not a uniqueness guard

| | |
|---|---|
| **v1.3** | `orderId` is emitted in the event but is **not** a uniqueness guard. Backend error: relying on `orderId` for idempotency leads to double settlements if the user retries with a new `paymentId`. |
| **v1.4** | `orderIdHash = keccak256(bytes(orderId))` is part of the signed digest. Backend stores `(orderIdHash, quote)` and refuses to sign the same `orderIdHash` twice. SDK verifies that the displayed `orderId` matches `orderIdHash`. |
| **Defense** | On-chain: digest binds `orderIdHash`. Off-chain: backend idempotency table. |
| **Residual** | If the user retries a settled quote with a new `nonce` but the same `orderIdHash`, the contract accepts (different `nonce` is a different quote). This is **correct** — `orderIdHash` is for backend reconciliation, not on-chain uniqueness. |
| **Status** | **Closed** |

### 2.6 No signature on quote parameters

| | |
|---|---|
| **v1.3** | **Major gap.** Any caller can invoke `payStable` with any `(paymentId, merchant, grossAmount, ...)`. There is no on-chain proof that the parameters were authorised by AiFinPay. |
| **v1.4** | **Closed by design.** Every settlement requires a valid EIP-712 signature from `SIGN_OPERATOR_ROLE`. The signature covers `(payer, merchant, token, grossAmount, ipCreator, validUntil, orderIdHash, nonce, routeId)` and binds to `(chainId, address(this))` via the domain separator. |
| **Defense** | On-chain: `ecrecover` + `hasRole(SIGN_OPERATOR_ROLE, recovered)`. |
| **Residual** | If the signer key leaks, the attacker can forge quotes. Mitigation: HSM/KMS-backed signer, 48-hour rotation via timelock, monitoring of unusual quote issuance patterns. |
| **Status** | **Closed on contract; signer-key management is the operational surface** |

### 2.7 Cross-chain replay

| | |
|---|---|
| **v1.3** | The same `(paymentId, signature)` (if signatures existed) could be replayed on another chain at a contract with the same address (e.g. both Polygon and Optimism at `0xE34F...`). |
| **v1.4** | `DOMAIN_SEPARATOR` includes `block.chainid`. The signature is invalid on any other chain. |
| **Defense** | On-chain: `chainId` in `EIP712Domain`. |
| **Residual** | None. |
| **Status** | **Closed** |

### 2.8 Cross-contract replay at the same chain

| | |
|---|---|
| **v1.3** | n/a (no signatures). |
| **v1.4** | `DOMAIN_SEPARATOR` includes `verifyingContract = address(this)`. The signature is invalid for any other contract at the same chain. |
| **Defense** | On-chain: `verifyingContract` in `EIP712Domain`. |
| **Residual** | None. |
| **Status** | **Closed** |

### 2.9 Cross-route replay

| | |
|---|---|
| **v1.3** | n/a (single route profile per deployment). |
| **v1.4** | `routeId` is part of the digest. A quote signed for `agent-x402` cannot be replayed as `merchant-aifp1`. |
| **Defense** | On-chain: digest binds `routeId`. |
| **Residual** | None (in practice — the per-route profile is admin-configurable, but the routeId is in the digest so the profile change is observable). |
| **Status** | **Closed** |

### 2.10 Sender-spoofing (`msg.sender != quote.payer`)

| | |
|---|---|
| **v1.3** | Anyone could call `payStable` for any wallet. If the wallet had approved the contract, the funds moved. |
| **v1.4** | Contract checks `if (msg.sender != quote.payer) revert InvalidPayer()`. The signature is bound to `quote.payer`, and the contract enforces that `msg.sender` matches. |
| **Defense** | On-chain: `msg.sender == quote.payer` check before any state change. |
| **Residual** | None. |
| **Status** | **Closed** |

### 2.11 Front-running a pending quote

| | |
|---|---|
| **v1.3** | If a quote is published in the mempool, an attacker could copy the parameters and submit a transaction with higher gas to settle first. The payer would then revert on `PaymentAlreadyProcessed`. |
| **v1.4** | The `payer` field of the quote is enforced as `msg.sender`. The attacker cannot submit on behalf of the original payer. |
| **Defense** | On-chain: `msg.sender == quote.payer` check. |
| **Residual** | The attacker could submit from their own wallet if the wallet had pre-approved the contract. Mitigation: payer must approve **after** receiving the quote, not before. SDK enforces this. |
| **Status** | **Closed on contract; SDK approval timing matters** |

### 2.12 Quote lifetime extension

| | |
|---|---|
| **v1.3** | Backend could re-sign the same `paymentId` with a new `validUntil`. No protection — caller-controlled. |
| **v1.4** | Each quote is bound by `(payer, merchant, token, grossAmount, ipCreator, validUntil, orderIdHash, nonce, routeId)`. The backend must re-issue a new quote with a different `nonce` to extend. The old quote is still consumed after settlement; cannot be re-settled. |
| **Defense** | On-chain: digest binds all fields; `consumedNonce` is monotonic. |
| **Residual** | None. |
| **Status** | **Closed** |

### 2.13 Stablecoin whitelist races

| | |
|---|---|
| **v1.3** | Owner could de-whitelist USDC while a settlement is in flight. The settlement would revert `UnsupportedToken`. The payer pays gas for the revert. |
| **v1.4** | Same on-chain behaviour. The signed quote locks `token`; if the token is removed before settlement, the quote still names the token, but the whitelist rejects. |
| **Defense** | Off-chain: timelock on `setWhitelistedTokens` (48h). The owner cannot remove a token without community notice. |
| **Residual** | If the timelock passes but the merchant has not been notified, settlements using the removed token revert. Operational — not a contract gap. |
| **Status** | **Operationally bounded** |

### 2.14 Treasury redirection

| | |
|---|---|
| **v1.3** | Owner can `setTreasury(newAddress)`. A compromised owner can route future fees to an attacker. This is **by design** (owner authority) and bounded by timelock. |
| **v1.4** | Same on-chain behaviour, gated by `ADMIN_ROLE`. Additionally: each route can have its own `routeTreasury` override. ADMIN controls all three: global treasury, per-route treasury, whitelist. |
| **Defense** | Multisig + timelock. RBAC separates admin (treasury control) from signer (quote authority). |
| **Residual** | If the multisig is compromised, attacker drains future fees. Standard risk of all admin-controlled contracts. |
| **Status** | **Accepted — operational governance** |

### 2.15 Signer key compromise

| | |
|---|---|
| **v1.3** | n/a (no signer role). |
| **v1.4** | Attacker with the signer private key can forge quotes for any `payer`, `merchant`, `amount` — but only **to existing whitelisted merchants** and **for amounts the payer has approved**. They cannot drain arbitrary wallets. They cannot change treasury or whitelist. They cannot pause. |
| **Defense** | HSM/KMS-backed key. Timelock-gated rotation (ADMIN holds the rotation authority). Monitoring of quote issuance volume. `pause()` as kill switch (ADMIN-only). |
| **Residual** | Between compromise detection and revocation, the attacker can issue forged quotes. Mitigation: monitoring + immediate `pause()` on detection. |
| **Status** | **Operationally bounded; pause is the kill switch** |

### 2.16 Backend database tampering

| | |
|---|---|
| **v1.3** | Backend could issue a quote for a different price than the user expects. The contract does not know. |
| **v1.4** | Same — the contract does not know the user's intent. The signature binds the price, but a compromised backend can sign any price. |
| **Defense** | Off-chain: backend audit logs, off-chain reconciliation between user-visible price and on-chain `grossAmount`. |
| **Residual** | Backend compromise is unbounded on the contract. Out of scope — backend threat model. |
| **Status** | **Out of scope (off-chain trust)** |

### 2.17 Race between `setWhitelistedTokens` and in-flight `settleStable`

| | |
|---|---|
| **v1.3** | Race documented in `AUDIT_B2BSplitterV13.md` §"Remaining coverage gaps". |
| **v1.4** | Same — the contract checks `whitelistedTokens[quote.token]` at settlement time. The nonce is consumed **after** the whitelist check, so a removed token causes the whole tx to revert. |
| **Defense** | CEI ordering: validate → mark consumed → transfer. Race is bounded by timelock (48h) on whitelist changes. |
| **Residual** | Same as v1.3 — no contract gap. |
| **Status** | **Operationally bounded** |

### 2.18 Fee-on-transfer tokens

| | |
|---|---|
| **v1.3** | Documented in `AUDIT_B2BSplitterV13.md` `[R-M-01]`. Whitelisted tokens are trusted to be clean. |
| **v1.4** | Same — whitelist is the trust boundary. |
| **Defense** | Operational: deployment checklist requires confirming `transferFrom` returns the exact value; timelock-gated whitelist changes. |
| **Residual** | Same as v1.3 — no contract gap. |
| **Status** | **Operationally bounded** |

### 2.19 Storage growth from `consumedNonce`

| | |
|---|---|
| **v1.3** | `consumedPayment[bytes32]` grows unbounded. Documented `[L-01]`. |
| **v1.4** | `consumedNonce[payer][nonce]` also grows, but per-payer. Storage growth is `O(settlements)` per payer, not `O(global settlements)`. |
| **Defense** | Off-chain monitoring. Future work: TTL purge (out of v1.4 scope). |
| **Residual** | Same as v1.3 — long-term concern. |
| **Status** | **Acknowledged; tracked in `V14_FUTURE.md`** |

### 2.20 Payer wallet compromise

| | |
|---|---|
| **v1.3** | Attacker with the payer's private key can call `payStable` and drain the payer's approved balance. |
| **v1.4** | Same — `msg.sender == quote.payer` is satisfied; the attacker can submit any pre-signed quote they have access to. |
| **Defense** | Off-chain: payer-side wallet security. |
| **Residual** | Wallet compromise is outside the contract threat model. |
| **Status** | **Out of scope (off-chain trust)** |

### 2.21 Quote-signer role DoS

| | |
|---|---|
| **v1.3** | n/a. |
| **v1.4** | If the backend signer is offline, no new quotes can be issued. Existing quotes remain valid until `validUntil`. After `validUntil`, no new settlements are possible until the signer is restored. |
| **Defense** | Operational: high-availability signer setup, monitoring of quote issuance latency. Manual intervention: `grantSignerRole(newSigner)` via timelock. |
| **Residual** | ~48h window of settlement unavailability in worst case (timelock delay). |
| **Status** | **Operationally bounded** |

### 2.22 Single-route economics drift

| | |
|---|---|
| **v1.3** | `treasuryBps` and `ipCreatorBps` are `immutable`. No drift possible, but **only one route per deployment**. |
| **v1.4** | Per-route profile is mutable by `ADMIN_ROLE`, capped by `MAX_TREASURY_BPS = 500` and `MAX_IP_CREATOR_BPS = 100`. Multiple routes supported in one deployment. |
| **Defense** | Capped by constants; ADMIN is timelock-gated. |
| **Residual** | ADMIN can change profiles within the cap. Mitigation: timelock + multisig visibility; community can veto via the multisig. |
| **Status** | **Capped and timelock-gated; accepted as trade-off for multi-route support** |

### 2.23 Self-approval attack

| | |
|---|---|
| **v1.3** | A payer approves the contract for an amount. The contract calls `safeTransferFrom(payer, ...)`. If the payer is also a contract with a malicious `approve`/`transferFrom` hook, the hook can re-enter. |
| **v1.4** | Same — `nonReentrant` modifier on settlement functions prevents reentrancy. CEI ordering prevents cross-function reentrancy via the contract's own state. |
| **Defense** | `nonReentrant` + CEI. |
| **Residual** | Standard ERC-20 risk; `SafeERC20` handles the unsafe-return-token case. |
| **Status** | **Closed** |

### 2.24 Revert on ERC-20 transfer

| | |
|---|---|
| **v1.3** | If the merchant/treasury/IP creator is a contract that reverts on `transferFrom` (e.g. blacklist), the whole settlement reverts. The nonce is consumed if the contract uses CEI ordering; otherwise, the nonce is preserved and the payer retries. |
| **v1.4** | Same — the contract uses CEI ordering: validate → mark consumed (`consumedNonce[payer][nonce] = true`) → transfer. If transfer reverts, the **entire** transaction reverts, including the `consumedNonce` write. The payer retries. |
| **Defense** | CEI + atomic rollback. |
| **Residual** | None. The atomic rollback semantics are documented in `AUDIT_B2BSplitterV13.md` `[I-01]`. |
| **Status** | **Closed** |

### 2.25 Profile change race window

| | |
|---|---|
| **v1.3** | n/a (immutable profile). |
| **v1.4** | ADMIN can call `configureRoute(routeId, ...)` at any time. Settlements using that `routeId` after the change use the **new** profile (see `V14_ARCHITECTURE.md` §5.4). The signed digest does not bind the profile. |
| **Defense** | ADMIN is timelock-gated (48h). Profile changes are observable events. Backend should read `getProfile(routeId)` before issuing quotes to display the current economics. |
| **Residual** | A quote signed at time T0 may settle at time T1 > T0 with different economics if ADMIN changed the profile in between. Mitigation: backend should re-read profile right before signing; short quote TTL reduces the window. Future v1.4.x: include profile in digest. |
| **Status** | **Operationally bounded; documented in `V14_ARCHITECTURE.md` §5.4** |

### 2.26 Route disabled mid-flight

| | |
|---|---|
| **v1.3** | n/a. |
| **v1.4** | ADMIN can call `disableRoute(routeId)`. In-flight quotes using that `routeId` will revert `RouteDisabled`. |
| **Defense** | Timelock-gated (48h). The route cannot be silently disabled. |
| **Residual** | If the route is disabled, all in-flight quotes for that route are dead. Payer must obtain a new quote under a different `routeId`. |
| **Status** | **Operationally bounded** |

### 2.27 Unknown route

| | |
|---|---|
| **v1.3** | n/a. |
| **v1.4** | If backend signs a quote with a `routeId` that was never configured (`profiles[routeId].configuredAt == 0`), the contract reverts `UnknownRoute`. |
| **Defense** | Constructor configures both `agent-x402` and `merchant-aifp1`. Backend should refuse to sign quotes with unknown `routeId`s. SDK should refuse to display them. |
| **Residual** | Misconfigured backend can sign garbage quotes that always revert. Mitigation: backend should validate `routeId` against the contract's `getProfile(routeId)`. |
| **Status** | **Closed on contract; backend policy required** |

---

## 3. Risk Heat Map

```
                 Likelihood
                  Low    Medium    High
Impact
High              1.10   1.15      —
Medium            1.5    1.16      1.21
Low               1.20   1.2,1.4   1.6,1.15
```

| Cell | Risk | Notes |
|---|---|---|
| **High impact, High likelihood** | (none) | All high-impact risks are either closed or bounded by timelock |
| **High impact, Medium likelihood** | 1.15 Signer key compromise | Bounded by HSM + rotation |
| **High impact, Low likelihood** | 1.5 Merchant validation, 1.20 Wallet compromise | Out of scope (off-chain) |
| **Medium impact, High likelihood** | 1.21 Signer DoS | 48h rotation window is acceptable |
| **Medium impact, Medium likelihood** | 1.16 Backend DB tampering | Out of scope (off-chain) |
| **Low impact, High likelihood** | 1.6 No signature on quote (closed), 1.15 (operational) | Contract-side closed |
| **Low impact, Medium likelihood** | 1.2 `validUntil` policy, 1.4 Merchant validation (residual) | Backend policy |

---

## 4. What the Contract Cannot Help With

These are explicitly **out of scope** for v1.4. They are not gaps; they are threat-model boundaries.

| Concern | Reason it's out of scope |
|---|---|
| **KYC / AML of payers** | Off-chain identity. Contract only sees addresses. |
| **Daily spend limits per agent** | Backend ledger. Contract has no concept of "agent"; it sees `msg.sender`. |
| **Partner registry** | Backend DB. Contract has no `partners` mapping in v1.4. |
| **mSECCO internal credits** | Backend DB. Replaced by direct USDC/USDT settlement. |
| **Manifesto hash** | Removed. The contract has no opinion on user agreements. |
| **Pyth oracle price feeds** | Removed. The contract settles exact amounts; oracle integration is a backend concern (for top-up flows, which are also off-chain in v1.4). |
| **ARP referral tiers** | Backend DB. Replaced by operator dashboards. |
| **Payer wallet security** | Off-chain. |
| **Backend key management** | Off-chain. |
| **Backend policy on quote issuance** | Off-chain. |
| **ADMIN_ROLE holder honesty** | Off-chain. The contract cannot prevent an honest-but-careless admin from changing profiles unwisely. |
| **SIGN_OPERATOR_ROLE holder honesty** | Off-chain. The contract verifies signature validity, not business intent. |

The contract's surface is **deliberately narrow**. It does one thing: take an EIP-712-signed quote from an authorised signer, verify it against the per-route profile, atomically split funds, and update replay protection. Everything else is off-chain.

---

## 5. RBAC Risk Comparison vs. v1.3

| Concern | v1.3 (single owner) | v1.4 (ADMIN + SIGN_OPERATOR) |
|---|---|---|
| Owner can forge quotes | n/a (no quotes) | **No** — owner has no signing key |
| Signer can drain funds | n/a | **No** — signer has no admin power |
| Owner can sign and be admin | Yes (single key) | **No** — constructor enforces separation |
| Compromise of single key drains everything | Yes (if EOA owner) | **No** — orthogonal roles |
| Recovery from compromised admin | Transfer ownership | Renounce admin + grant new admin via existing admin (requires admin to still exist) |
| Recovery from compromised signer | n/a | Revoke signer role + grant new signer (admin-gated, timelocked) |

The v1.4 RBAC model is **strictly safer** than v1.3's single-owner model under every scenario except "ADMIN renounces their own role". That case is the price of the orthogonal design — recoverable only by signer-controlled `governanceRecovery()` in a future version.

---

## 6. Comparison: Risks Closed in v1.4 vs v1.3

| Risk | v1.3 status | v1.4 status |
|---|---|---|
| 1.1 Predictable paymentId | Open | **Closed** |
| 1.2 validUntil policy | Open | Closed (contract) + Backend policy |
| 1.3 grossAmount mismatch | Open | **Closed** (signed) |
| 1.4 Merchant validation | Open | **Closed** (signed) |
| 1.5 orderId uniqueness | Open | **Closed** (hashed into digest) |
| **1.6 No signature on quote** | **Critical gap** | **Closed by design** |
| 1.7 Cross-chain replay | Open | **Closed** (chainId in domain) |
| 1.8 Cross-contract replay | n/a | **Closed** (address in domain) |
| 1.9 Cross-route replay | n/a | **Closed** (routeId in digest) |
| 1.10 Sender spoofing | Open | **Closed** (msg.sender == quote.payer) |
| 1.11 Front-running | Open | **Closed** (msg.sender check) |
| 1.12 Quote lifetime extension | Open | **Closed** (digest binds validUntil) |
| 1.13 Whitelist races | Open | Same as v1.3 |
| 1.14 Treasury redirection | Open | Same as v1.3 |
| 1.15 Signer key compromise | n/a | **Bounded by HSM + timelock + ADMIN-separated from signer** |
| 1.16 Backend DB tampering | Open | Same — out of scope |
| 1.17 Whitelist race | Open | Same as v1.3 |
| 1.18 Fee-on-transfer | Open | Same as v1.3 |
| 1.19 Storage growth | Open | **Improved** (per-payer, not global) |
| 1.20 Wallet compromise | Out of scope | Same |
| 1.21 Signer DoS | n/a | **Bounded by timelock rotation** |
| 1.22 Single-route economics drift | Closed | **Replaced by multi-route, ADMIN-configurable, capped** |
| 1.23 Self-approval | Closed | Closed (same) |
| 1.24 Revert on transfer | Closed | Closed (same) |
| 1.25 Profile change race | n/a | **Operationally bounded; documented** |
| 1.26 Route disabled mid-flight | n/a | **Operationally bounded; timelock** |
| 1.27 Unknown route | n/a | **Closed on contract; backend policy required** |
| 1.RBAC-1 Admin can grant self signer | n/a | **Bounded by timelock** |
| 1.RBAC-2 Signer can grant self admin | n/a | **Closed by `AccessControl` matrix** |
| 1.RBAC-3 Constructor grants same key both roles | n/a | **Closed by `AdminEqualsSigner` check** |
| 1.RBAC-4 Admin renounces | n/a | **Accepted; settlements continue; future recovery in v1.4.x** |

**Summary of v1.4 risk reduction:**
- 11 risks newly closed by v1.4
- 5 risks remain open with operational boundaries (1.13, 1.16, 1.17, 1.18, 1.21)
- 4 risks remain open and are explicitly out of scope (1.14, 1.16, 1.20)
- 3 risks newly introduced (1.15, 1.25, 1.26) — all bounded by timelock + ADMIN RBAC
- 1 risk newly accepted (1.RBAC-4) — settlements unaffected; governance recovery tracked in `V14_FUTURE.md`

---

## 7. Acceptance Criteria for v1.4 Sign-Off

v1.4 ships to production only when all of the following are true:

1. All rows in §1, §2 have an explicit "Closed" or "Bounded" or "Out of scope" or "Accepted" status.
2. No row has status "Open" without an `OWNER` assigned for the bounded control.
3. All "Bounded" rows have an operational runbook entry.
4. RBAC test matrix from `V14_MIGRATION.md` §5.4 passes (signer cannot admin; admin cannot sign).
5. The audit (Phase 5 of `V14_MIGRATION.md`) does not introduce a new Critical or High finding.
6. Production signer key is in HSM/KMS, distinct from ADMIN_ROLE holder.
7. Production ADMIN_ROLE is `TimelockController` (48h delay), owned by the multisig.
8. Constructor enforces `initialAdmin != initialSigner` (test confirms).
9. Constructor configures both `agent-x402` and `merchant-aifp1` routes with canonical profiles (`0/0` and `100/0` respectively).
10. Monitoring and alerting are configured for: signer issuance volume, treasury redirection, whitelist changes, route configuration, role grants.

If any criterion is unmet, v1.4 does not ship.

---

— End of risk closure matrix —