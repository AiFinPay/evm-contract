# AiFinPay — Polygon Smart Contracts

> **Payment and identity infrastructure for the agentic economy.**
> AI agents pay for services autonomously via the x402 protocol. Atomic on-chain splits in one transaction.

This repo is in a dual-mode migration period: **v1.3/v5.3 Core+Passport+mSECCO contracts** are still deployed and supported, while **v1.4 B2BSplitterV14** (EIP-712 signed quotes, multi-route, RBAC) is being added alongside them. Legacy contracts will be removed from the repo once SDK/backend have fully migrated (Phase 6 of `docs/V14_MIGRATION.md`).

## Deployed Contracts (Polygon Mainnet)

### v1.4 (current — splitter-only, signed, multi-route)

| Contract | Address |
|----------|---------|
| B2BSplitterV14 | *(pending production deploy)* |
| TimelockController | *(pending production deploy)* |

### v5.3 / v1.3 (legacy — Core+Passport+mSECCO+Splitter)

| Contract | Address |
|----------|---------|
| AiFinPayCore | `0x8Ad9830D16b1f10333866a3f38C949CbB19F4BAD` |
| AgentPassport | `0x66fFe91eE0B80f386EB07F97354e2889CD162185` |
| MSECCOToken | `0x83936231c80fdF17eC2786BD7DcF09014552182B` |
| B2BSplitter | `0xE34Fc0E6694821c600Fa0955C0F74720ea6d8440` |
| Gnosis Safe | `0xD31d82c4b35DABaA2ad7023C89A78A052D1f3c8e` |

---

## What It Does

When an AI agent calls a paid API (e.g. Exa AI, io.net), it receives an HTTP 402 payment request. The AiFinPay SDK intercepts this, pays from the agent's wallet, and the smart contract atomically splits the payment:

| Recipient | Share |
|-----------|-------|
| Merchant | 98.99% |
| AiFinPay Treasury | 1.00% |
| IP Creator (royalty) | 0.01% |

No custodial holding. No manual forwarding. Settled on-chain in ~2 seconds.

---

## Prerequisites

- Node.js 22.13.0+ (Hardhat 3 requirement)
- Bun (package manager)
- Hardhat 3

```bash
bun install
```

---

## Build

```bash
bun run build
```

Compiled artifacts: `artifacts/`
TypeChain types: `typechain-types/`

---

## Test

```bash
bun test
# run a single test
bun test --grep "agent pays merchant"
```

---

## Deploy

### v1.4 B2BSplitterV14 (current)

```bash
# Polygon mainnet
bun run deploy:v14

# Amoy testnet
bun run deploy:v14:testnet
```

Records the splitter in `deployments/<network>-v14-latest.json`. Full production bootstrap (timelock + multisig + KMS signer) is in `docs/V14_DEPLOYMENT_CHECKLIST.md`.

### Legacy v5.3 Core + v1.3 Splitter

```bash
# Polygon mainnet
bun run deploy

# Amoy testnet
bun run deploy:testnet

# B2BSplitter v1.3 only
bun run deploy:splitter
```

**Legacy deployment order:**
1. Deploy `MSECCOToken` with deployer as owner
2. Deploy `AgentPassport` with deployer as owner
3. Deploy `AiFinPayCore` (links to MSECCOToken + AgentPassport)
4. Call `setCore()` on MSECCOToken and AgentPassport pointing to AiFinPayCore
5. Deploy `B2BSplitter`
6. Transfer ownership of all contracts to the Gnosis Safe

> **Note:** `setCore()` is one-time only on all legacy contracts — cannot be changed after setting.

Required environment variables in `.env`:
- Testnets: `DEV_DEPLOYER_KEY`
- Mainnets: `PROD_DEPLOYER_KEY`
- `ETHERSCAN_API_KEY` (unified Etherscan v2) or legacy `POLYGONSCAN_API_KEY`
- `POLYGON_MAINNET_RPC` / `AMOY_RPC` (optional; fallbacks are provided)

---

## Verify

```bash
npx hardhat verify --network polygon --build-profile production DEPLOYED_CONTRACT_ADDRESS [constructor args...]
```

---

## Lint & Format

```bash
bun run lint           # solhint
bun run prettify       # prettier --write
bun run prettify:check # prettier --check
```

---

## Contract Overview

### B2BSplitterV14 (v1.4)
New splitter-only contract. Receives an EIP-712 signed quote and atomically splits payment to merchant, treasury, and IP creator. Supports multiple `routeId`s (`agent-x402`, `merchant-aifp1`) in a single deployment. Governed by `AccessControl` (`ADMIN_ROLE` + `SIGN_OPERATOR_ROLE`).

### AiFinPayCore (v5.3, legacy)
Main protocol contract. Handles top-ups, B2B payment routing, and agent registration.

### AgentPassport (v5.3, legacy)
Soulbound ERC-721 NFT. One per agent wallet. Non-transferable. Stores daily spend limit, status, and IP creator.

### MSECCOToken (v5.3, legacy)
Non-transferable ERC-20 compute credits. 1 USD cent = 1 mSECCO. Only mintable/burnable by AiFinPayCore.

### B2BSplitter (v1.2/v1.3, legacy)
Atomic payment splitter. Receives payment and forwards 98.99% / 1% / 0.01% in one transaction.

---

## Audit

- **v5.3 / v1.3:** Security audit by **Pironmind Tech** (May 2026). All findings resolved. See `docs/IMPLEMENTATION.md` for full list of fixes.
- **v1.4:** Pending re-audit. Tracked in `docs/V14_MIGRATION.md` Phase 5.

---

## Related

- **v1.4 migration plan:** `docs/V14_MIGRATION.md`
- **v1.4 architecture:** `docs/V14_ARCHITECTURE.md`
- **v1.4 deployment checklist:** `docs/V14_DEPLOYMENT_CHECKLIST.md`
- **Solana contract:** https://github.com/syedhassan125/aifinpay
- **SDK (Node + Python):** https://github.com/AiFinPay/sdk
- **Protocol versions:** v5.3 (legacy Core/Passport), v1.4 (current splitter)
