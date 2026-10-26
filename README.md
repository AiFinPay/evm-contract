# AiFinPay — Polygon Smart Contracts

> **Payment and identity infrastructure for the agentic economy.**
> AI agents pay for services autonomously via the x402 protocol. Atomic on-chain splits in one transaction.

This repository maintains **B2BSplitterV14** (EIP-712 signed quotes, multi-route, RBAC). Legacy v1.3/v5.3 Core+Passport+mSECCO contracts have been removed from the repo; historical deployment records remain in `deployments/` and `registry/`.

## Deployed Contracts (Polygon Mainnet)

### v1.4 (current — splitter-only, signed, multi-route)

| Contract | Address |
|----------|---------|
| B2BSplitterV14 | `0x78bed24B8D3A5eB2cf8D9A0D6A9Da6Bc5d7f32eB` |
| TimelockController | No Polygon deployment record |
| Gnosis Safe | `0x01b80329ff81ce1d22a9e2e8807df5f92414c3c3` |

The Polygon v1.4 deployment record lists the Safe as the splitter's admin and marks settlement enabled. That record does not establish that a TimelockController currently holds admin roles or that a paid end-to-end settlement has been verified. Check on-chain state and route-specific operational evidence before making readiness claims.

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

- Node.js/Bun

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
bun run deploy

# Amoy testnet
bun run deploy --network amoy
```

Records the splitter in `deployments/<network>-v14-<network>-latest.json`. Full production bootstrap (timelock + multisig + KMS signer) is in `docs/V14_DEPLOYMENT_CHECKLIST.md`.

Required environment variables in `.env`:
- Testnets: `DEV_DEPLOYER_KEY`
- Mainnets: `PROD_DEPLOYER_KEY`
- `ETHERSCAN_API_KEY` (unified Etherscan v2) or legacy `POLYGONSCAN_API_KEY`
- `POLYGON_MAINNET_RPC` / `AMOY_RPC` (optional; fallbacks are provided)

---

## Verify

```bash
bun run verify --network polygon
bun run verify --network amoy
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
Current splitter-only contract. Receives an EIP-712 signed quote and atomically splits payment to merchant, treasury, and IP creator. Supports multiple `routeId`s (`agent-x402`, `merchant-aifp1`) in a single deployment. Governed by `AccessControl` (`ADMIN_ROLE` + `SIGN_OPERATOR_ROLE`).

### TimelockWrapper
Production governance helper. Deploys an OpenZeppelin `TimelockController` and wires it as the `ADMIN_ROLE` holder of `B2BSplitterV14`.

---

## Related

- **v1.4 migration plan:** `docs/V14_MIGRATION.md`
- **v1.4 architecture:** `docs/V14_ARCHITECTURE.md`
- **v1.4 deployment checklist:** `docs/V14_DEPLOYMENT_CHECKLIST.md`
- **Solana contract:** https://github.com/syedhassan125/aifinpay
- **SDK (Node + Python):** https://github.com/AiFinPay/sdk
- **Protocol version:** v1.4 (current splitter)
