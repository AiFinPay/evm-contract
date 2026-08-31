# Timelock Implementation Summary (v5.5)

> **STATUS, 2026-08-28 — does not describe the deployed v1.3 splitters.**
> The eighteen production `B2BSplitterV13` deployments are owned **directly** by
> the governance Safe `0xFd936f75D9221949f2FEaB54Cd342F7527154eD5` (3-of-5),
> verified on chain by `scripts/verify-registry.mjs`. No `TimelockController`
> holds ownership of any v1.3 splitter, so the 48-hour delay described below
> does **not** apply to `pause`, `unpause`, `setTreasury` or
> `setWhitelistedTokens` on those contracts today: a 3-of-5 Safe transaction
> executes them immediately. Whether that is the accepted governance model, or
> ownership moves to a verified timelock, is an open decision (audit of
> 2026-08-27, "Timelock security claims do not match the deployed ownership
> model"). Until it is made, read this document as the design of the timelock
> component, not as a statement about production.

## Overview

<!-- governance-status: direct-safe -->

A **48-hour timelock** is *proposed* for all critical protocol operations, to
address the centralization risk raised as audit finding EVM-HIGH-001 and
re-raised as P0 #3 in the v1.3 audit. It has been written and tested; ownership
was never transferred, so the risk is open. Read the status banner above before
anything below it.

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

5. **`docs/SECURITY_AUDIT.md`**
   - Updated to reflect timelock implementation
   - Listed here as marking EVM-HIGH-001 resolved. **`docs/SECURITY_AUDIT.md`
     does not exist in this repository**, and the finding is still open.

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

## Protected Functions

None of these is timelock-protected today; all are callable immediately by the
3-of-5 Safe. Once ownership is transferred, these `onlyOwner` functions would
require the 48-hour delay:

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

| Benefit | Before | After |
|---------|--------|-------|
| **Rug Prevention** | ❌ Instant | ✅ 48h delay |
| **Community Reaction** | ❌ None | ✅ 48h window |
| **Multisig Enforcement** | ⚠️ Off-chain | ✅ On-chain |
| **Transparent Governance** | ⚠️ Partial | ✅ Full |
| **Audit Compliance** | ❌ EVM-HIGH-001 | ✅ Resolved |

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

- [ ] Deploy TimelockWrapper contract *(written, never deployed)*
- [ ] Deploy TimelockController (via wrapper) *(no address on any chain)*
- [ ] Transfer ownership of AiFinPayCore
- [ ] Transfer ownership of B2BSplitter
- [ ] Transfer ownership of B2BSplitterV13
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
- [Security Audit EVM-HIGH-001](./SECURITY_AUDIT.md)
- [Timelock Setup Guide](./TIMELOCK_SETUP.md)

## Conclusion

The timelock implementation successfully addresses the centralization risk identified in the security audit. All critical protocol parameters now require a 48-hour delay before execution, providing the community with adequate time to react to any malicious proposals.

**Status**: ❌ Not deployed — proposal only
**Audit Status**: ❌ EVM-HIGH-001 open; re-raised as v1.3 audit P0 #3
**Deployment Priority**: 🔴 HIGH (before mainnet launch)
