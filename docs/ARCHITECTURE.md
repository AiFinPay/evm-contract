# AiFinPay EVM Contracts — Architecture

> **Version:** v1.4 (splitter-only, EIP-712 signed quotes, multi-route, RBAC)  
> **Legacy status:** `AiFinPayCore v5.3`, `AgentPassport`, `MSECCOToken`, and the v1.3 single-route splitters have been removed from the active codebase. Historical deployment records remain in `deployments/` and `registry/`.  
> **Canonical configuration:** `hardhat.config.ts`, `foundry.toml`, `registry/registry.json`, `config/v14-production-config.ts`, and the per-chain deployment JSON files under `deployments/`. This document contains no live configuration values.

---

## 1. What the protocol does

An AI agent calls a paid API (for example Exa AI, io.net) and receives an HTTP 402 payment requirement. The AiFinPay SDK intercepts it, submits the signed payment instruction from the agent's wallet, and the smart contract atomically splits the funds in a single transaction:

| Recipient | Share |
|-----------|-------|
| Merchant | 98.99% |
| AiFinPay Treasury | 1.00% |
| IP Creator (royalty) | 0.01% |

The exact economics are selected at settlement time by the `routeId` carried in the EIP-712 quote.

---

## 2. v1.4 design principles

1. **Splitter-only contracts.** Business logic that is not a payment-routing concern (mSECCO credits, seats, manifesto, ARP tiers, partner registry, daily limits) lives in backend systems and databases.
2. **Cryptographically bound quotes.** Every quote is signed over `(chainId, contract, payer, merchant, token, grossAmount, ipCreator, validUntil, orderIdHash, nonce, routeId)`. The on-chain surface is the source of truth.
3. **One deployment, many routes.** A single `B2BSplitterV14` deployment supports both `agent-x402` and `merchant-aifp1` via per-route profile storage.
4. **Orthogonal RBAC.** `ADMIN_ROLE` owns governance; `SIGN_OPERATOR_ROLE` signs quotes; `PAUSER_ROLE` can halt settlement. No single key can do another key's job.
5. **Configuration in config files only.** Network addresses, stablecoin addresses, governance Safe addresses, and fee profiles live in `config/v14-production-config.ts`, `registry/registry.json`, and `deployments/`. They are **not** duplicated in this document.

---

## 3. Contract surface

### Active contracts

| Contract | Type | Responsibility |
|----------|------|----------------|
| `B2BSplitterV14` | Core router | Verifies EIP-712 quotes, enforces replay protection, pausability, and RBAC; atomically splits native or ERC-20 payments |
| `Profiles` | Satellite | Per-route economics: `treasuryBps`, `ipCreatorBps`, `enabled`, optional `routeTreasury` override |
| `TokenList` | Satellite | Stablecoin allow-list read at settlement time |
| `TimelockWrapper` | Bootstrap helper | Deploys an OpenZeppelin `TimelockController` and wires it as `ADMIN_ROLE` holder of v1.4 targets (or transfers `Ownable` ownership for legacy targets) |

### Removed contracts

| Contract | Reason |
|----------|--------|
| `AiFinPayCore v5.3` | Business logic (seats, manifesto, ARP tiers, mSECCO, daily limits, partner registry) moved off-chain |
| `AgentPassport` | Soulbound identity state moved to backend; quote signature binds wallet to verified identity |
| `MSECCOToken` | Internal non-transferable credits replaced by direct USDC/USDT/native settlement |
| `B2BSplitterV13` | Single-route-per-deployment model replaced by multi-route `B2BSplitterV14` |

---

## 4. Component diagram

```
                       ┌─────────────────────────────────────────┐
                       │           B2BSplitterV14                │
                       │   splitter-only multi-route router      │
                       │                                         │
   Backend signer ───┐ │   AccessControl {                        │
   SIGN_OPERATOR_ROLE │ │     ADMIN_ROLE        → Timelock        │
   off-chain ECDSA    │ │     SIGN_OPERATOR_ROLE → backend KMS    │
   secp256k1          │ │     PAUSER_ROLE       → Gnosis Safe     │
   ──────────────────┘ │   }                                      │
                       │   EIP-712 quote verification             │
                       │   Pausable                               │
                       │                                         │
                       │   settleNative(Quote, signature)        │
                       │   settleStable(Quote, signature)        │
                       └─────────────┬───────────────────────────┘
                                     │
            ┌────────────────────────┼────────────────────────┐
            │                        │                        │
            ▼                        ▼                        ▼
    ┌──────────────┐        ┌──────────────┐        ┌────────────────────┐
    │   Profiles   │        │  TokenList   │        │  TimelockController │
    │ route economics│        │ allow-list   │        │  (48h delay, OZ)    │
    └──────────────┘        └──────────────┘        └────────────────────┘
            │                        │                         ▲
            │                        │                         │ proposer/executor = Safe
            └────────────────────────┼─────────────────────────┘
                                     │
                       3 atomic transfers
                                     ▼
            ┌────────────────────────────────────────────────────┐
            │  Merchant wallet  │  Treasury / routeTreasury  │  IP creator  │
            └────────────────────────────────────────────────────┘
```

---

## 5. Contract responsibilities

### `B2BSplitterV14`

- Verifies EIP-712 signatures and checks the recovered signer has `SIGN_OPERATOR_ROLE`.
- Enforces `msg.sender == quote.payer`, quote deadline, and sequential per-payer nonce.
- Resolves route economics from `Profiles` and validates the token against `TokenList`.
- Splits `grossAmount` into merchant, treasury, and IP-creator legs.
- Performs atomic native or ERC-20 transfers using `SafeERC20`.
- Supports emergency `pause()` by `ADMIN_ROLE` or `PAUSER_ROLE`; `unpause()` is `ADMIN_ROLE`-only.
- Exposes `quoteHash(Quote)`, `digest(Quote)`, and `quoteTotal(...)` for off-chain quote assembly.

### `Profiles`

- Stores a monotonic set of route identifiers and their profiles.
- Constructor seeds the canonical `agent-x402` (`0/0`) and `merchant-aifp1` (`100/0`) routes.
- `configureRoute` is `ADMIN_ROLE`-only and caps fees at `MAX_TREASURY_BPS = 500` and `MAX_IP_CREATOR_BPS = 100`.
- `disableRoute` / `enableRoute` toggle settlement for a route without deleting it.
- `getProfile` reverts on unknown or disabled routes.

### `TokenList`

- Holds the ERC-20 allow-list for stablecoin settlement.
- `isAllowed` returns `false` for `address(0)` and unlisted tokens.
- Batch updates are `ADMIN_ROLE`-only.

### `TimelockWrapper`

- Deploys an OpenZeppelin `TimelockController` with a minimum 48-hour delay.
- For legacy `Ownable` contracts: `transferToTimelock` / `transferMultiple`.
- For v1.4 `AccessControl` contracts: `grantRoleToTimelock` / `renounceRoleOnTarget`.
- `destroy()` renounces the wrapper's optional `TimelockController` admin role and forwards any balance.

---

## 6. Quote lifecycle

A detailed specification of the EIP-712 quote format is in `docs/V14_QUOTE_FORMAT.md`. Summary:

```
Quote {
    payer,       // address — must equal msg.sender
    merchant,    // address — non-zero
    token,       // address(0) for native, otherwise whitelisted ERC-20
    grossAmount, // uint256
    ipCreator,   // address(0) if no creator fee, otherwise required
    validUntil,  // uint256 — block.timestamp deadline
    orderIdHash, // bytes32 — backend correlation key
    nonce,       // uint256 — must equal payerNonce[payer]
    routeId      // bytes32 — selects route profile
}

signature = secp256k1(EIP712_HASH(DOMAIN_SEPARATOR, QUOTE_TYPEHASH, Quote))
```

Settlement flow:

1. Backend validates the payer and route, assigns the next on-chain nonce, and signs the quote.
2. SDK displays the signed quote to the payer.
3. Payer calls `settleNative` (with `msg.value`) or `settleStable` (after ERC-20 approval).
4. Contract recovers the signer, validates role/deadline/payer/merchant/route/nonce, marks the nonce consumed, and executes the split atomically.

---

## 7. RBAC

| Role | Holder | Powers |
|------|--------|--------|
| `DEFAULT_ADMIN_ROLE` (alias `ADMIN_ROLE`) | `TimelockController` in production | Grant/revoke roles, unpause, set treasury, manage whitelist, configure/disable/enable routes |
| `SIGN_OPERATOR_ROLE` | Backend KMS-backed signer | Sign quotes only — no admin or pause powers |
| `PAUSER_ROLE` | Gnosis Safe | Call `pause()` instantly — cannot unpause |

Separation guarantees:

- A compromised admin cannot forge quotes without first timelock-granting itself `SIGN_OPERATOR_ROLE`.
- A compromised signer cannot change treasury, whitelist, routes, or pause.
- A compromised pauser can only halt settlement; unpausing remains timelock-gated.

Granting any of these roles to an address that already holds another mutually exclusive role reverts, enforced in the overridden `grantRole` function.

---

## 8. Multi-chain model

The same v1.4 contract build is deployed to every supported EVM chain. Per-chain differences live only in:

- `hardhat.config.ts` — RPC and verification config.
- `config/v14-production-config.ts` — stablecoin addresses and governance environment variables per chain.
- `registry/registry.json` — pinned deployment addresses, runtime code hash, fee profiles, and `settlementEnabled` flag.
- `deployments/<network>-v14-latest.json` — the actual deployment record for each network.

The SDK uses `registry/generated/splitter-table.json` (produced by `scripts/generate-sdk-table.mjs`) as its canonical routing table.

---

## 9. Security patterns

| Pattern | Applied in |
|---------|------------|
| Checks-Effects-Interactions | `_verifyQuote` marks nonce consumed before any external transfer |
| `SafeERC20` | `settleStable` for all ERC-20 transfers |
| `ReentrancyGuardTransient` | Both settlement functions |
| `Pausable` | Settlement only; admin actions remain possible while paused |
| `AccessControl` | `B2BSplitterV14`, `Profiles`, `TokenList` |
| 48-hour timelock | All `ADMIN_ROLE` actions in production |
| EIP-712 domain binding | `chainId` and `verifyingContract` prevent cross-chain and cross-contract replay |
| Per-payer monotonic nonce | Prevents replay, pre-emption, and predictable-ID DoS |

---

## 10. Canonical sources of truth

Live configuration and deployed addresses are **not** stored in this document. Use:

- `hardhat.config.ts` — network/verification/compiler configuration.
- `foundry.toml` — Foundry build profile.
- `config/v14-production-config.ts` — chain-level stablecoin defaults and governance environment variables.
- `registry/registry.json` — canonical SDK routing targets and governance Safe.
- `README.md` — human-facing deployed addresses for Polygon mainnet (orientation only).
- `deployments/<network>-v14-latest.json` — actual deployment records per network.

Do not copy configuration values into documentation files. Keep them only in the files above so changes remain auditable and mechanically verifiable.
