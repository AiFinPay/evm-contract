# B2BSplitter v1.4 — Production Deployment Checklist

**Status:** operational runbook
**Audience:** deployer, multisig signers, backend, security
**Networks:** Polygon mainnet, Amoy testnet

This checklist walks through deterministically deploying `B2BSplitterV14`
through a canonical CREATE3 factory under full timelock + multisig governance.
Testnet steps are the same except `ADMIN_ROLE` stays with the deployer EOA.

---

## 1. Pre-conditions

- [ ] Node.js `>= 22.13.0` installed.
- [ ] `bun install` has been run and `bun.lock` is up to date.
- [ ] `bun run build` passes and `typechain-types/` are generated.
- [ ] `bun test` passes (v1.4 suite).
- [ ] `bun run lint` and `bun run prettify:check` pass.
- [ ] Production deployer key (`PROD_DEPLOYER_KEY`) is funded with MATIC for gas.
- [ ] Gnosis Safe address is known and signers are available.
- [ ] Production KMS-backed signer public key is known and loaded in the signer service.
- [ ] Stablecoin addresses for the target chain are in `config/v14-production-config.ts`.
- [ ] `.env` is present at repo root and not committed.
- [ ] The canonical CreateX factory address is pinned in `.env` as `CREATE3_FACTORY_<chainId>` (default: `0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed`).

---

## 2. Environment variables

```bash
# Deployer
export PROD_DEPLOYER_KEY=0x...

# Production governance (per-chain Safe + treasury; same Safe can be used for both)
export AIFINPAY_SAFE_137=0xYourGnosisSafeAddress
export AIFINPAY_TREASURY_137=0xGnosisSafeTreasuryAddress   # usually same as Safe

# Backend signer (KMS-backed public key) — same across networks
export AIFINPAY_V14_SIGNER=0xKmsBackedSignerPublicKey

# Optional dedicated pauser (defaults to the Safe)
# export AIFINPAY_PAUSER_137=0x...

# Canonical CreateX factory for the target chain (same address on every chain)
export CREATE3_FACTORY_137=0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed

# Timelock bootstrap (used by deploy-timelock.ts)
export SAFE_ADDRESS=$AIFINPAY_SAFE_137
export EXECUTOR_ADDRESS=$AIFINPAY_SAFE_137

# Verification
export ETHERSCAN_API_KEY=...                          # unified Etherscan v2 preferred
# or
export POLYGONSCAN_API_KEY=...

# RPC overrides (optional)
export POLYGON_MAINNET_RPC=https://...
export AMOY_RPC=https://...
```

---

## 3. Testnet dry run (Amoy)

```bash
# 1. Deploy v1.4 with deployer as ADMIN_ROLE
bun run deploy --network amoy

# 2. Record the splitter address from deployments/amoy-v14-latest.json
export SPLITTER_V14=0x...

# 3. Verify source
bun run verify --network amoy

# 4. Configure routes if not done at construction
#    (constructor should already configure agent-x402 and merchant-aifp1)
```

Run a paid end-to-end settlement on both routes before mainnet deploy.

---

## 4. Mainnet deploy

### 4.1 Deploy B2BSplitterV14

```bash
bun run deploy:v14
```

The deploy script:
- Uses `PROD_DEPLOYER_KEY` as the deployer.
- Reads the canonical `CREATE3_FACTORY_<chainId>` from env (default:
  `0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed`) and deploys through CreateX.
- Sets the deployer EOA as initial `ADMIN_ROLE`.
- Sets `AIFINPAY_V14_SIGNER` as initial `SIGN_OPERATOR_ROLE`.
- Sets `AIFINPAY_PAUSER_137` (defaults to `AIFINPAY_SAFE_137`) as initial `PAUSER_ROLE`.
- Sets `AIFINPAY_TREASURY_137` as the global treasury.
- Deploys `TokenList` and `Profiles` satellites via CreateX CREATE3 with
  deterministic, deployer-scoped salts.
- Deploys `B2BSplitterV14` via CreateX CREATE3 with a deterministic salt.
- Configures `agent-x402` (`0/0`) and `merchant-aifp1` (`100/0`) routes at construction.
- Predicts and prints each deployed address before/after the deploy transaction.
- Writes the record to `deployments/polygon-v14-production-latest.json`.

**Address determinism:** Using the same deployer EOA + CreateX salt on any chain
produces the same contract address, independent of constructor arguments. The
salts encode the deployer address as a permissioned-deploy prefix, so only the
configured EOA can land at the predicted address.

Record:
```bash
export SPLITTER_V14=$(jq -r '.splitter.address' deployments/polygon-v14-production-latest.json)
```

### 4.2 Verify source

```bash
bun run verify --network polygon
```

### 4.3 Deploy TimelockController

```bash
bun run deploy:timelock --network polygon
```

This deploys `TimelockWrapper`, which in turn deploys `TimelockController` with a 48-hour delay and proposer/executor set to the Safe.

Record:
```bash
export TIMELOCK=$(jq -r '.timelock.controller' deployments/polygon-timelock-latest.json)
export WRAPPER=$(jq -r '.timelock.wrapper' deployments/polygon-timelock-latest.json)
```

---

## 5. Transfer governance to TimelockController

The deployer EOA currently holds `ADMIN_ROLE`. Choose one of the following paths.

### Path A — two Safe proposals (manual, always available)

#### Proposal A — grant ADMIN_ROLE to TimelockController

Target: `SPLITTER_V14`  
Function: `grantRole(bytes32 role, address account)`  
Role: `0x0000000000000000000000000000000000000000000000000000000000000000` (`DEFAULT_ADMIN_ROLE`)  
Account: `TIMELOCK`

#### Proposal B — revoke ADMIN_ROLE from deployer

Target: `SPLITTER_V14`  
Function: `revokeRole(bytes32 role, address account)`  
Role: `0x0000000000000000000000000000000000000000000000000000000000000000`  
Account: deployer EOA address

Schedule and execute both through the Safe → TimelockController flow.

### Path B — TimelockWrapper helper (single Safe proposal)

If the wrapper is granted `ADMIN_ROLE` first, the Safe can call the wrapper helpers directly:

1. Deployer EOA grants `ADMIN_ROLE` to `WRAPPER`.
2. Safe calls `wrapper.grantRoleToTimelock(SPLITTER_V14, ADMIN_ROLE)`.
3. Safe calls `wrapper.renounceRoleOnTarget(SPLITTER_V14, ADMIN_ROLE)`.
4. Safe calls `wrapper.destroy()` to renounce the wrapper's optional TimelockController admin role.

After either path:

```bash
# Confirm TimelockController is admin
cast call $SPLITTER_V14 "hasRole(bytes32,address)" \
  0x0000000000000000000000000000000000000000000000000000000000000000 \
  $TIMELOCK --rpc-url $POLYGON_MAINNET_RPC

# Confirm deployer is no longer admin
cast call $SPLITTER_V14 "hasRole(bytes32,address)" \
  0x0000000000000000000000000000000000000000000000000000000000000000 \
  $DEPLOYER --rpc-url $POLYGON_MAINNET_RPC
```

Expected: `true` for TimelockController, `false` for deployer.

---

## 6. Signer role verification

Confirm the production KMS signer has `SIGN_OPERATOR_ROLE`:

```bash
cast call $SPLITTER_V14 "hasRole(bytes32,address)" \
  $(cast keccak "SIGN_OPERATOR_ROLE") \
  $SIGNER_ADDRESS --rpc-url $POLYGON_MAINNET_RPC
```

Expected: `true`.

---

## 7. Post-deploy checks

| Check | Command / Action | Expected result |
|---|---|---|
| ADMIN_ROLE is TimelockController | `hasRole(DEFAULT_ADMIN_ROLE, TIMELOCK)` | `true` |
| Deployer has no ADMIN_ROLE | `hasRole(DEFAULT_ADMIN_ROLE, DEPLOYER)` | `false` |
| Signer has SIGN_OPERATOR_ROLE | `hasRole(SIGN_OPERATOR_ROLE, AIFINPAY_V14_SIGNER)` | `true` |
| Pauser has PAUSER_ROLE | `hasRole(PAUSER_ROLE, AIFINPAY_PAUSER_137)` | `true` |
| Treasury is the Safe | `treasury()` | `AIFINPAY_TREASURY_137` |
| Routes configured | `profiles.getProfile(routeId("agent-x402"))` | enabled, treasuryBps=0, ipCreatorBps=0 |
| Routes configured | `profiles.getProfile(routeId("merchant-aifp1"))` | enabled, treasuryBps=100, ipCreatorBps=0 |
| Stablecoins whitelisted | `tokenList.isAllowed(USDC)` | `true` |
| Stablecoins whitelisted | `tokenList.isAllowed(USDT)` | `true` |
| Contract verified | Block explorer | green checkmark |

---

## 8. Registry update

After mainnet deploy and verification:

1. Add the v1.4 entry to `registry/registry.json` under `splitters`.
2. Run `bun run verify-registry` or `node scripts/verify-registry.mjs --pin` to pin runtime code hash and ownership.
3. Run `node scripts/generate-sdk-table.mjs` to update `registry/generated/splitter-table.json`.
4. Do **not** set `settlementEnabled: true` until a paid end-to-end settlement has succeeded on each route.

---

## 9. Monitoring checklist

Configure alerts for:

- `Payment` events by `routeId` (volume, gross amount).
- `RoleGranted` / `RoleRevoked` for `ADMIN_ROLE` and `SIGN_OPERATOR_ROLE`.
- `RouteConfigured` / `RouteDisabled` / `RouteEnabled` events.
- `TreasuryUpdated` event.
- `Paused` / `Unpaused` events.
- Signer quote issuance rate from backend metrics.

---

## 10. Rollback reference

If a critical issue is found after deploy:

1. The Safe pauser calls `pause()` instantly (no timelock delay) using its `PAUSER_ROLE`.
2. All settlements revert `EnforcedPause()`. Existing routes stop processing.
3. Alternatively, the Safe can schedule `disableRoute(routeId)` via TimelockController for the affected route only.
4. Investigate on a mainnet fork; fix, audit, deploy v1.4.1 if needed.
5. SDK points back to v1.3 endpoints while v1.4 is paused.

See `V14_MIGRATION.md` §9 for full rollback strategy.

---

— End of deployment checklist —
