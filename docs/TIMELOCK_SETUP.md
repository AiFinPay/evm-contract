# Timelock Setup Guide

## Overview

<!-- governance-status: direct-safe -->

> **Not deployed.** No `TimelockController` owns any v1.3 splitter; all
> eighteen are owned directly by the 3-of-5 governance Safe and can be changed
> with no delay. See
> [TIMELOCK_IMPLEMENTATION.md](./TIMELOCK_IMPLEMENTATION.md) for the on-chain
> state and the open governance decision.

A **48-hour timelock** is *proposed* for all critical protocol parameters, to
prevent rug-pull attacks and give the community time to react to malicious
proposals. Everything below describes how it would work once deployed.

## What's Protected

The following operations now require a 48-hour timelock delay:

*(The ✅ marks below mean "would be timelock-protected", not "is protected today".)*

### AiFinPayCore
- ✅ `setFees()` - Change treasury/IP creator fee percentages
- ✅ `setTreasury()` - Change treasury address
- ✅ `setArpFees()` - Change referral tier percentages
- ✅ `setManifestoHash()` - Change agreement hash
- ✅ `pause()` / `unpause()` - Emergency pause

### B2BSplitter / B2BSplitterV13
- ✅ `setSplit()` - Change fee split percentages
- ✅ `setTreasury()` - Change treasury address
- ✅ `pause()` / `unpause()` - Emergency pause

## Architecture

```
┌─────────────────┐
│  Gnosis Safe    │ ← Proposer (schedules operations)
│  (Multisig)     │
└────────┬────────┘
         │
         │ 48h delay
         ↓
┌─────────────────┐
│ TimelockController │ ← ADMIN_ROLE holder of all contracts
│  (48h delay)    │
└────────┬────────┘
         │
         │ After delay
         ↓
┌─────────────────┐
│   Executor      │ ← Executes scheduled operations
│  (Can be Safe)  │
└─────────────────┘
```

## Deployment

### 1. Deploy Timelock

```bash
export SAFE_ADDRESS=0xYourSafeAddress
export EXECUTOR_ADDRESS=0xExecutorAddress  # Can be same as SAFE
bun run deploy:timelock --network polygon
```

### 2. Transfer ADMIN_ROLE

For v1.4 contracts there is no `Ownable` owner. After deployment, grant `ADMIN_ROLE` to the TimelockController and revoke it from the deployer EOA:

```typescript
// In deploy-timelock.ts or a follow-up proposal:
await splitterV14.grantRole(await splitterV14.ADMIN_ROLE(), timelockController);
await splitterV14.renounceRole(await splitterV14.ADMIN_ROLE(), deployer);
```

For legacy `Ownable` contracts (v1.2/v1.3), use `transferMultiple` as before:

```typescript
await wrapper.transferMultiple([core, splitterV12, splitterV13]);
```

### 3. Verify

```bash
# Check v1.4 admin
cast call $CONTRACT_ADDRESS "hasRole(bytes32,address)" $(cast keccak "DEFAULT_ADMIN_ROLE") $TIMELOCK_ADDRESS --rpc-url $RPC_URL

# Should return 0x0000000000000000000000000000000000000000000000000000000000000001
```

## Usage

### Schedule an Operation (Safe)

```bash
# Example: Change treasury fee to 2%
cast send $TIMELOCK_ADDRESS \
  "schedule(address,uint256,bytes,bytes32,bytes32,uint256)" \
  $CONTRACT_ADDRESS \
  0 \
  $(cast calldata "setSplit(uint256,uint256)" 200 0) \
  0x0...0 \
  0x0...0 \
  $(date -d "+48 hours" +%s) \
  --private-key $SAFE_KEY
```

### Execute an Operation (Executor)

```bash
cast send $TIMELOCK_ADDRESS \
  "execute(address,uint256,bytes,bytes32,bytes32)" \
  $CONTRACT_ADDRESS \
  0 \
  $(cast calldata "setSplit(uint256,uint256)" 200 0) \
  0x0...0 \
  0x0...0 \
  --private-key $EXECUTOR_KEY
```

### Cancel an Operation (Safe)

```bash
cast send $TIMELOCK_ADDRESS \
  "cancel(bytes32)" \
  $OPERATION_ID \
  --private-key $SAFE_KEY
```

## Emergency Pause

`v1.4` adds a dedicated `PAUSER_ROLE` (held by the Gnosis Safe) that can call `pause()` instantly, while `unpause()` remains `ADMIN_ROLE`-only and timelock-gated. For legacy contracts (`v1.3` and earlier), `pause()` is `onlyOwner` and therefore timelocked when the owner is the TimelockController.

## Security Benefits

1. **48h Reaction Window** - Community can monitor scheduled operations
2. **Multisig Integration** - Works with Gnosis Safe for multi-sig approval
3. **Transparent** - All operations visible on-chain before execution
4. **Non-Custodial** - No single point of failure

## Monitoring

Set up alerts for:
- `CallScheduled` events on TimelockController
- `CallExecuted` events
- Any `onlyOwner` function calls

**Recommended Tools:**
- Tenderly alerts
- OpenZeppelin Defender
- Custom webhook on `CallScheduled` event

## Migration Checklist

- [ ] Deploy TimelockController via TimelockWrapper
- [ ] Transfer ownership of AiFinPayCore
- [ ] Transfer ownership of B2BSplitter
- [ ] Transfer ownership of B2BSplitterV13
- [ ] Verify ownership on all contracts
- [ ] Test scheduling a simple operation
- [ ] Set up monitoring alerts
- [ ] Document process for team
- [ ] Announce to community

## Troubleshooting

**Q: Operation failed with "Insufficient delay"**  
A: Ensure timestamp is at least 48 hours in the future

**Q: "Caller is not proposer"**  
A: Only the Safe (proposer) can schedule operations

**Q: "Operation is not ready"**  
A: Wait until the scheduled time has passed

**Q: "Operation has already been executed"**  
A: Each operation can only be executed once

## References

- [OpenZeppelin TimelockController Docs](https://docs.openzeppelin.com/contracts/4.x/api/governance#TimelockController)
- [Gnosis Safe Integration Guide](https://docs.safe.global/advanced/smart-account-timelock)
- [Audit Recommendation EVM-HIGH-001](./SECURITY_AUDIT.md)
