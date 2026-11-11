# Timelock Setup Guide

<!-- governance-status: direct-safe -->

This guide covers deploying a `TimelockController` and transferring v1.4 admin roles to it. A Polygon v1.4 deployment record lists the Gnosis Safe as the splitter admin; the repository contains no Polygon timelock deployment record. Confirm current on-chain state before scheduling governance changes.

## Deploy the timelock

Set the deployer, Safe proposer, and executor:

```bash
export PROD_DEPLOYER_KEY=0x...
export SAFE_ADDRESS=0xYourGnosisSafeAddress
export EXECUTOR_ADDRESS=$SAFE_ADDRESS
bun run deploy:timelock --network polygon
```

The script deploys `TimelockWrapper` and its `TimelockController`, configured with a 48-hour minimum delay, then records both addresses in `deployments/polygon-timelock-latest.json`. It does not transfer any target roles. The controller does not govern a contract until that contract's admin role is transferred.

```bash
export TIMELOCK=$(jq -r '.timelock.controller' deployments/polygon-timelock-latest.json)
export WRAPPER=$(jq -r '.timelock.wrapper' deployments/polygon-timelock-latest.json)
```

## Transfer v1.4 admin roles

The v1.4 targets are `B2BSplitterV14`, `TokenList`, and `Profiles`. For each target, use the Safe to:

1. Grant `DEFAULT_ADMIN_ROLE` to the TimelockController.
2. Confirm the TimelockController has the role.
3. Revoke `DEFAULT_ADMIN_ROLE` from the Safe.

Alternatively, grant the wrapper `DEFAULT_ADMIN_ROLE` on each target, then use the Safe proposer to call `grantRoleToTimelock(target, DEFAULT_ADMIN_ROLE)` and `renounceRoleOnTarget(target, DEFAULT_ADMIN_ROLE)`. After all targets are wired, call `wrapper.destroy()` to renounce the wrapper's optional TimelockController admin role. Revoke the Safe's admin role from every target after confirming the controller has it.

Keep `PAUSER_ROLE` assigned to the designated pauser if immediate emergency pausing is required. It is separate from `DEFAULT_ADMIN_ROLE`.

## Verify

For each target, verify that the TimelockController has `DEFAULT_ADMIN_ROLE` and that the Safe and wrapper do not. Also confirm the controller's minimum delay is at least `172800` seconds:

```bash
cast call $TIMELOCK "getMinDelay()" --rpc-url $POLYGON_MAINNET_RPC
cast call $SPLITTER_V14 "hasRole(bytes32,address)" \
  0x0000000000000000000000000000000000000000000000000000000000000000 \
  $TIMELOCK --rpc-url $POLYGON_MAINNET_RPC
cast call $SPLITTER_V14 "hasRole(bytes32,address)" \
  0x0000000000000000000000000000000000000000000000000000000000000000 \
  $SAFE_ADDRESS --rpc-url $POLYGON_MAINNET_RPC
```

Repeat the role checks for `TokenList` and `Profiles`. Confirm signer and pauser roles, route profiles, and token allow-list state against the deployment record. Update deployment metadata only after the corresponding on-chain and route-specific checks have succeeded. Deploying a controller alone is not evidence that admin actions are timelocked.

## References

- `contracts/TimelockWrapper.sol` — wrapper role-transfer behavior.
- `docs/V14_DEPLOYMENT_CHECKLIST.md` — deployment and post-deployment checks.
- `scripts/verify-governance-docs.mjs` — checks governance markers against configured on-chain owners.
