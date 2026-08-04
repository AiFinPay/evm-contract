# AiFinPay — Implementation Status (Polygon)

## Protocol Version: v5.3
## Audit: Pironmind Tech — May 2026

---

## Audit Findings — Resolution Status

### Production remediation — 4 August 2026

| ID | Finding | Status | Fix |
|----|---------|--------|-----|
| H-02 | Core deducted the IP-creator share even when the creator address was zero, leaving value in the contract | Fixed in source; redeploy required | Compute the creator share only for a non-zero creator and return the remainder to the merchant; regression tests assert all recipient deltas and a zero Core balance |

### Critical

| ID | Finding | Status | Fix |
|----|---------|--------|-----|
| CRIT-001 | Stablecoin decimal conversion wrong — `amount/100` caused 100x mSECCO over-minting | ✅ Fixed | Changed to `amount / STABLE_DECIMALS_DIVISOR` (10,000) — correct for 6-decimal USDC/USDT |

### High

| ID | Finding | Status | Fix |
|----|---------|--------|-----|
| HIGH-001 (Core) | `mintPassport()` not reentrancy-protected | ✅ Fixed | Added `nonReentrant` modifier |
| HIGH-001 (Passport) | `_safeMint()` called before state written — reentrancy bypass possible | ✅ Fixed | State written before `_safeMint()` (CEI pattern) |

### Medium

| ID | Finding | Status | Fix |
|----|---------|--------|-----|
| MED-001 | `b2bPay()` didn't enforce daily spend limit | ✅ Fixed | Added `passport.checkAndSpend()` call |
| MED-002 | `setCore()` could be called multiple times | ✅ Fixed | One-time guard on MSECCOToken + AgentPassport |

### Low

| ID | Finding | Status | Fix |
|----|---------|--------|-----|
| LOW-001 | Raw `IERC20.transferFrom()` used — silently returns false on some tokens | ✅ Fixed | All transfers use `SafeERC20.safeTransferFrom()` |

---

## Features Implemented

### Core Protocol
- [x] Agent Passport minting (soulbound ERC-721, one per wallet)
- [x] mSECCO top-up via MATIC (Pyth oracle)
- [x] mSECCO top-up via USDC/USDT (6 decimal handling)
- [x] B2B atomic split payment (98.99% / 1% / 0.01%)
- [x] Daily spending limit per agent (auto-resets daily)
- [x] Passport status management (BORN / ACTIVE / VERIFIED_B2B / SUSPENDED)
- [x] Emergency pause/unpause
- [x] IP creator royalty on every B2B payment

### Security
- [x] SafeERC20 for all token operations
- [x] ReentrancyGuard on mintPassport
- [x] Checks-Effects-Interactions in mintPassport + b2bPay
- [x] STABLE_DECIMALS_DIVISOR constant (10,000) for decimal conversion
- [x] setCore() one-time-only on all contracts
- [x] Soulbound NFT (_beforeTokenTransfer blocks transfers)
- [x] Non-transferable mSECCO (transfer/transferFrom always revert)

---

## Pending / Phase 2

- [ ] Deploy AiFinPayCore v5.3 to Polygon Mainnet (pending Pironmind sign-off)
- [ ] TypeScript build (migrate from JS — per Pironmind recommendation)
- [ ] Hardhat test suite expansion
- [ ] Partner dashboard integration
- [ ] Agent wallet issuance UI

---

## Deployment History

| Date | Version | Notes |
|------|---------|-------|
| 2026-03-xx | v1.0 | Initial Polygon Mainnet deploy |
| 2026-04-xx | v5.0 | B2BSplitter added, Gnosis Safe treasury |
| 2026-05-14 | v5.3 | All Pironmind audit fixes applied |

---

## Contract Addresses (Polygon Mainnet)

```
AiFinPayCore:  0x8Ad9830D16b1f10333866a3f38C949CbB19f4BAD
AgentPassport: 0x66fFe91eE0B80f386EB07F97354e2889CD162185
MSECCOToken:   0x83936231c80fdF17eC2786BD7DcF09014552182B
B2BSplitter:   0xE34Fc0E6694821c600Fa0955C0F74720ea6d8440
Gnosis Safe:   0xD31d82c4b35DABaA2ad7023C89A78A052D1f3c8e
```
