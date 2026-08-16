# AiFinPay Central Treasury — EVM v1.3 Deployment Runbook

Status: **source/deployment RC only — no mainnet route is enabled by this document.**

## Architecture

AIFP-1 settlement and treasury consolidation are intentionally two separate operations.

1. The agent pays the local immutable B2BSplitterV13.
2. The merchant receives 99% of the gross amount atomically.
3. The AiFinPay 1% protocol fee is transferred atomically to a low-balance **operational treasury collector** on the same chain.
4. The merchant payment is complete. No bridge or swap is on the AIFP-1 critical path.
5. A separate post-settlement Treasury Sweeper later consolidates eligible collector balances into canonical **Base USDC** held by one central Base Safe.

AIFP-2/x402 remains `0/0`; no protocol-fee transfer occurs under that route.

## Key separation

- `owner`: governance/admin Safe on the source EVM chain.
- `treasury`: operational EVM collector address used only to receive/sweep protocol fees.
- `deployer`: temporary funded deployment EOA; it must not equal the operational collector.
- `central Base Safe`: final capital-storage multisig on Base; it is independently verified by the deployment wrapper.

The operational collector is deliberately not the governance Safe. This avoids requiring multisig signatures for every automated micro-fee sweep while keeping contract administration under multisig control. The collector must be kept low-balance and swept according to the Treasury Sweeper policy.

## Required configuration

For source chain `<chainId>`:

- `PROD_DEPLOYER_KEY_<network>` / existing Hardhat production signer configuration.
- `AIFINPAY_SAFE_<chainId>`: real governance Safe on the source chain.
- `AIFINPAY_TREASURY_COLLECTOR_EVM`: pinned operational collector address derived from the dedicated treasury signer.
- `AIFINPAY_CENTRAL_TREASURY_SAFE_BASE`: one final Safe on Base.
- `BASE_RPC` or `BASE_RPC_URL`: used to verify the central Safe independently.
- `FEE_PROFILE=merchant-aifp1` for the 1% route, or `agent-x402` for the 0% route.
- `SOURCE_COMMIT=<frozen reviewed SHA>`.
- `CONFIRM_MAINNET_DEPLOY=<chainId>:<profile>:central-treasury` only after reviewing preflight output.

Stablecoin addresses continue to come from the issuer-gated v1.3 production configuration. Unsupported assets remain zero addresses unless an explicit reviewed override is approved.

## Mandatory preflight checks

The wrapper `scripts/deploy-splitter-v13-central-treasury.ts` refuses deployment unless:

- source chain is one of AiFinPay's nine production EVM networks;
- deployer has native gas balance;
- governance address has contract code and exposes Safe `getOwners()` / `getThreshold()`;
- Safe has at least two unique owners and threshold >= 2;
- operational collector is non-zero and is not the deployment EOA;
- central Base treasury address has contract code on Base and independently passes the same Safe owner/threshold checks;
- configured USDC/USD₮ token addresses, when non-zero, have code and readable decimals;
- the explicit mainnet confirmation string matches the exact chain and route.

## Post-deployment evidence

The wrapper writes `deployments/central-treasury/<chainId>-<profile>.json` containing:

- `status: DEPLOYED_DISABLED`;
- source network / chain ID / route;
- deployment transaction hash;
- deployed splitter address and runtime code hash;
- frozen source commit;
- governance Safe owners/threshold;
- operational collector;
- central Base Safe owners/threshold;
- canonical Base USDC identifier;
- local stablecoin configuration;
- immutable route economics;
- `settlementEnabled: false`;
- `e2eVerified: false`.

Do not edit either flag to true merely because deployment succeeded.

## Activation sequence

1. Independent human review of EVM PR #9 and the central-treasury wrapper.
2. Freeze exact source SHA and build artifact.
3. Verify/create source-chain governance Safe and central Base Safe.
4. Verify the dedicated treasury collector addresses from the mounted treasury signer.
5. Deploy AIFP-2 `0/0` and AIFP-1 `100/0` route instances from the frozen artifact.
6. Capture deployment/runtime/config evidence.
7. Install independent backend/wallet route pins with the route still disabled.
8. Run minimal-value paid settlement E2E.
9. Run a minimal-value treasury sweep E2E from the local collector to the central Base Safe.
10. Verify local collector debit, provider/bridge state, Base USDC Safe credit, ledger/reconciliation and retry/replay behavior.
11. Only after evidence acceptance enable the payment route and treasury automation for that exact network/asset path.

## Explicit non-goals

- No bridge call is executed inside B2BSplitterV13.
- The central Safe private keys are never used by the Treasury Sweeper.
- The governance Safe private keys are never used by the Treasury Sweeper.
- An unreviewed bridged/lookalike token must never be promoted to canonical USDC/USD₮ solely by ticker.
- BOT Chain / XRPL EVM treasury bridging is not inferred from ecosystem marketing; it needs an exact reviewed provider adapter and E2E evidence.
