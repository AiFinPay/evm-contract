# Timelock — Proposal and Runbook (NOT ACTIVE)

<!-- governance-status: direct-safe -->

> **Status: NOT DEPLOYED. The 48-hour timelock described here does not exist
> on any chain.** Every v1.3 route splitter is owned *directly* by the
> governance Safe `0xFd936f75D9221949f2FEaB54Cd342F7527154eD5` (3-of-5).
> That Safe can change treasury, fee split, the token whitelist, or pause a
> route **immediately**, with no delay and no reaction window.
>
> Verified on-chain 2026-08-27: `owner()` on the v1.3 splitters returns the
> Safe; the Safe answers `getThreshold()` = 3 and has **no** `getMinDelay()`,
> so it is not a `TimelockController`. No timelock contract is recorded in
> `registry/registry.json` on any chain.
>
> This document is a **plan for work not yet done**, kept as the runbook for
> whoever executes it. Read every "✅" below as "what this would give us once
> deployed", never as a description of production. `scripts/verify-governance-docs.mjs`
> holds the marker above to the chain, and fails CI if the two disagree.

## Overview

A **48-hour timelock** is *proposed* for all critical protocol operations, to
address the centralization risk raised as audit finding EVM-HIGH-001 and
re-raised as P0 #3 in the v1.3 blockchain security audit (2026-08). It has been
written and tested, but ownership was never transferred, so the risk is open.

## Files Changed

### New Files
1. **`contracts/TimelockWrapper.sol`**
   - Helper contract for deploying TimelockController
   - Transfers ownership of multiple contracts atomically
   - Self-destructs after transfer (clean architecture)

2. **`scripts/deploy-timelock.ts`**
   - Automated deployment script
   - Configures Safe as proposer, optional separate executor
   - Ready for production deployment

3. **`docs/TIMELOCK_SETUP.md`**
   - Complete setup guide
   - Usage examples (schedule, execute, cancel)
   - Monitoring recommendations
   - Migration checklist

### Modified Files
1. **`contracts/AiFinPayCore.sol`**
   - Added NatSpec comments documenting timelock requirement
   - No functional changes (backward compatible)

2. **`contracts/B2BSplitter.sol`**
   - Added NatSpec comments documenting timelock requirement
   - No functional changes (backward compatible)

3. **`contracts/B2BSplitterV13.sol`**
   - Added NatSpec comments documenting timelock requirement
   - No functional changes (backward compatible)

4. **`package.json`**
   - Added `deploy:timelock` script

5. ~~`docs/SECURITY_AUDIT.md`~~
   - Listed here as updated, but **this file does not exist in the repository**.
   - EVM-HIGH-001 was never marked resolved anywhere, and must not be —
     the finding is still open.

## Architecture

```
┌─────────────────────┐
│   Gnosis Safe       │  ← Proposer (schedules operations)
│   (Multisig)        │
│   0xSafe...         │
└──────────┬──────────┘
           │
           │ Schedule operation
           ↓
┌─────────────────────┐
│ TimelockController  │  ← Owner of all contracts
│   48h delay         │  ← Must wait 48h before execution
│   0xTime...         │
└──────────┬──────────┘
           │
           │ After 48h delay
           ↓
┌─────────────────────┐
│   Executor          │  ← Executes scheduled operations
│   (Can be Safe)     │
│   0xExec...         │
└─────────────────────┘
```

## Functions the timelock *would* protect

None of these are timelock-protected today — all are callable immediately by
the 3-of-5 Safe. Once ownership is transferred, these `onlyOwner` functions
would require the 48-hour delay:

### AiFinPayCore
- ✅ `setFees()` - Fee percentage changes
- ✅ `setTreasury()` - Treasury address change
- ✅ `setArpFees()` - Referral tier changes
- ✅ `setManifestoHash()` - Agreement hash change
- ✅ `pause()` / `unpause()` - Emergency pause

### B2BSplitter / B2BSplitterV13
- ✅ `setSplit()` - Fee split changes
- ✅ `setTreasury()` - Treasury address change
- ✅ `pause()` / `unpause()` - Emergency pause

## Deployment Steps

### 1. Set Environment Variables
```bash
export SAFE_ADDRESS=0xYourGnosisSafeAddress
export EXECUTOR_ADDRESS=0xExecutorAddress  # Can be same as SAFE
```

### 2. Deploy Timelock
```bash
bun run deploy:timelock --network polygon
```

### 3. Transfer Ownership
Uncomment the ownership transfer lines in `deploy-timelock.ts`:
```typescript
await wrapper.transferMultiple([core, splitter, splitterV13]);
```

### 4. Verify
```bash
cast owner $CONTRACT_ADDRESS --rpc-url $RPC_URL
# Should return TimelockController address
```

## Security Benefits

Left column is production **today**; right column is what deploying this would
change. We are in the left column.

| Benefit | Today (deployed) | After timelock (not done) |
|---------|------------------|---------------------------|
| **Rug Prevention** | ❌ Instant | ✅ 48h delay |
| **Community Reaction** | ❌ None | ✅ 48h window |
| **Multisig Enforcement** | ⚠️ Off-chain | ✅ On-chain |
| **Transparent Governance** | ⚠️ Partial | ✅ Full |
| **Audit Compliance** | ❌ EVM-HIGH-001 open | ✅ Resolved |

## Monitoring Setup

### Alert Triggers
Set up alerts for these TimelockController events:

1. **`CallScheduled`** - New operation scheduled
   - Monitor all proposals
   - Alert team immediately

2. **`CallExecuted`** - Operation executed
   - Verify execution matches proposal
   - Confirm 48h delay was respected

3. **`Cancelled`** - Operation cancelled
   - Track cancellation reasons
   - Document for governance

### Recommended Tools
- **Tenderly** - Real-time alerts
- **OpenZeppelin Defender** - Automated monitoring
- **Custom Webhook** - On `CallScheduled` event

## Emergency Considerations

### Scenario: Critical Bug Discovered

**Problem**: Timelock prevents instant emergency pause

**Solutions**:
1. **Multisig Speed** - Ensure Safe can sign within hours, not days
2. **Separate PausableRole** - Deploy separate emergency pause role (future enhancement)
3. **Pre-signed Transaction** - Keep pre-signed pause transaction ready

### Scenario: Malicious Safe Compromise

**Problem**: Attacker gains control of Safe

**Mitigation**:
- ✅ Timelock provides 48h to react
- ✅ Community can monitor scheduled operations
- ✅ Can coordinate off-chain to prevent execution
- ✅ Can deploy emergency fork if needed

## Testing

### Test Timelock Flow
```bash
# 1. Schedule a fee change
cast send $TIMELOCK "schedule(...)"

# 2. Wait 48 hours (or use mainnet fork)

# 3. Execute
cast send $TIMELOCK "execute(...)"

# 4. Verify fee changed
cast call $CONTRACT "treasuryBps()"
```

### Unit Tests
All existing tests pass - timelock is transparent to contract logic.

## Migration Checklist

- [ ] Deploy TimelockWrapper contract *(written in `contracts/TimelockWrapper.sol`, never deployed)*
- [ ] Deploy TimelockController (via wrapper) *(no address on any chain)*
- [ ] Transfer ownership of AiFinPayCore
- [ ] Transfer ownership of B2BSplitter
- [ ] Transfer ownership of B2BSplitterV13 — **all 18 v1.3 route splitters**
- [ ] Verify ownership on all contracts
- [ ] Test scheduling a simple operation
- [ ] Set up monitoring alerts
- [ ] Document process for team
- [ ] Announce to community
- [ ] Update SDK/backend for timelock awareness

## Gas Costs

| Operation | Gas Cost | USD (at 30 gwei) |
|-----------|----------|------------------|
| Deploy TimelockWrapper | ~500k | ~$45 |
| Deploy TimelockController | ~2.5M | ~$225 |
| Transfer ownership (per contract) | ~50k | ~$4.50 |
| Schedule operation | ~100k | ~$9 |
| Execute operation | ~150k | ~$13.50 |

**Total one-time cost**: ~$280 USD

## References

- [OpenZeppelin TimelockController](https://docs.openzeppelin.com/contracts/4.x/api/governance#TimelockController)
- [Gnosis Safe Timelock Integration](https://docs.safe.global/advanced/smart-account-timelock)
- Security audit EVM-HIGH-001 — *(`docs/SECURITY_AUDIT.md` is referenced across
  this repo but does not exist; the finding lives in the external audit reports)*
- [Timelock Setup Guide](./TIMELOCK_SETUP.md)

## Conclusion

The centralization risk is **open**. The code in this repository would address
it, but it was never deployed, so today a 3-of-5 Safe can change treasury, fee
split, or the token whitelist on any of the 18 live v1.3 routes with no delay.

Choosing between the two governance models is a decision for the founders, not
a documentation fix:

- **A — keep direct Safe ownership.** Cheapest, keeps emergency pause instant.
  Accept and disclose that there is no reaction window. Requires no code.
- **B — deploy the TimelockController.** Restores the 48-hour window this
  document was written for; costs ~$280 in gas and makes emergency pause slow
  unless a separate pause role is deployed alongside (see *Emergency
  Considerations* above).

Until that decision is made and executed, no document, landing page, SDK
comment or partner-facing material may claim timelock protection.

**Status**: ❌ Not deployed — proposal only
**Audit Status**: ❌ EVM-HIGH-001 open; re-raised as v1.3 audit P0 #3
**Decision owner**: founders (see options A/B above)
