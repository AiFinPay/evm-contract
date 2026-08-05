# AiFinPay — Polygon Smart Contracts

> **Payment and identity infrastructure for the agentic economy.**
> AI agents pay for services autonomously via the x402 protocol. Atomic on-chain splits in one transaction.

## Deployed Contracts (Polygon Mainnet)

| Contract | Address |
|----------|---------|
| AiFinPayCore | `0x8Ad9830D16b1f10333866a3f38C949CbB19f4BAD` |
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

### Polygon Mainnet

```bash
bun run deploy
```

### Polygon Amoy (Testnet)

```bash
bun run deploy:testnet
```

### B2BSplitter only

```bash
bun run deploy:splitter
```

**Deployment order:**
1. Deploy `MSECCOToken` with deployer as owner
2. Deploy `AgentPassport` with deployer as owner
3. Deploy `AiFinPayCore` (links to MSECCOToken + AgentPassport)
4. Call `setCore()` on MSECCOToken and AgentPassport pointing to AiFinPayCore
5. Deploy `B2BSplitter`
6. Transfer ownership of all contracts to the Gnosis Safe

> **Note:** `setCore()` is one-time only on all contracts — cannot be changed after setting.

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

### AiFinPayCore
Main protocol contract. Handles top-ups, B2B payment routing, and agent registration.

### AgentPassport
Soulbound ERC-721 NFT. One per agent wallet. Non-transferable. Stores daily spend limit, status, and IP creator.

### MSECCOToken
Non-transferable ERC-20 compute credits. 1 USD cent = 1 mSECCO. Only mintable/burnable by AiFinPayCore.

### B2BSplitter
Atomic payment splitter. Receives payment and forwards 98.99% / 1% / 0.01% in one transaction.

---

## Audit

Security audit by **Pironmind Tech** (May 2026). All findings resolved — v5.3.
See `docs/IMPLEMENTATION.md` for full list of fixes.

---

## Related

- **Solana contract:** https://github.com/syedhassan125/aifinpay
- **SDK (Node + Python):** https://github.com/AiFinPay/sdk
- **Protocol version:** v5.3
