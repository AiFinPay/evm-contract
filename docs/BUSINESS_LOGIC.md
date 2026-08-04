# AiFinPay — Business Logic (Polygon)

## Core Value Proposition

AiFinPay is payment and identity infrastructure for the agentic economy. AI agents cannot autonomously pay for services — we fix that with the x402 protocol and atomic on-chain settlement.

---

## Payment Flow

### Consumer (Top-Up)
1. Developer deploys/registers an AI agent wallet
2. Calls `mintPassport()` — mints a soulbound Agent Passport NFT (one per wallet)
3. Tops up with MATIC, USDC, or USDT → mSECCO credits are minted to the agent
4. Passport status is set to `ACTIVE`

### B2B (Per-Call Payment)
1. AI agent calls a paid API → receives HTTP 402
2. AiFinPay SDK intercepts the 402 automatically
3. SDK calls `b2bPay()` on AiFinPayCore
4. Contract validates: passport status = VERIFIED_B2B, daily spend limit not exceeded
5. Payment is split atomically:
   - **98.99%** → merchant wallet
   - **1.00%** → AiFinPay treasury (Gnosis Safe 4-of-4)
   - **0.01%** → IP creator (from passport record)
   - If the passport has no IP creator, the unallocated creator share remains
     in the merchant amount. The contract balance must be zero after settlement.
6. SDK sends tx hash to API as proof of payment
7. API returns results to agent

---

## Token Economics

### mSECCO (ERC-20, non-transferable)
- 1 USD = 100 mSECCO (2 decimal places)
- Non-transferable — locked per agent wallet
- Mint: only via AiFinPayCore top-up
- Burn: only via AiFinPayCore b2bPay

### Agent Passport (ERC-721, soulbound)
- One per agent wallet — cannot be transferred after mint
- Stores: IP creator, metadata hash, status, daily limit, spend tracking, birth timestamp

### Supported Top-Up Assets
| Asset | Decimals | Conversion |
|-------|----------|------------|
| MATIC | 18 | Pyth oracle (MATIC/USD) |
| USDC | 6 | 1 cent = 10,000 base units |
| USDT | 6 | 1 cent = 10,000 base units |

---

## Passport Status Codes

| Code | Status | Meaning |
|------|--------|---------|
| 0 | BORN | Just minted, not funded |
| 1 | ACTIVE | Funded, normal operation |
| 2 | VERIFIED_B2B | Can make B2B payments |
| 3 | SUSPENDED | Blocked by admin |

---

## B2B Split Math

```
protocol_fee = amount × 100 / 10_000    (1.00%)
ip_fee       = amount × 1 / 10_000      (0.01%)
merchant     = amount - protocol - ip    (98.99%)
```

All splits happen in one atomic transaction — cannot partially fail.
For a zero IP-creator address, the creator fee is zero and the merchant receives
the remainder after the protocol fee.

---

## Security Model

- **Non-custodial**: funds never sit in contracts — split and forwarded in same tx
- **Soulbound passports**: one identity per wallet, cannot be traded
- **Non-transferable credits**: mSECCO cannot be moved between wallets
- **SafeERC20**: all token transfers use OpenZeppelin's safe wrappers
- **setCore() one-time**: core address cannot be changed after initialization
- **Treasury = Gnosis Safe 4-of-4**: no single point of control
- **Daily spend limits**: per-agent configurable caps with auto-reset
