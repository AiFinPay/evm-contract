# Legacy B2BSplitter v1.2 — historical evidence only

This directory preserves the exact v1.2 source/deploy/test artifacts removed from the active Hardhat compile/deploy/test tree during the 2026-08-17 remediation.

Canonical replacement: `contracts/B2BSplitterV13.sol` / PR #9 (`security/fee-on-top-v13-remediation`).

Do not deploy these artifacts. v1.2 has mutable `setSplit`, a non-zero creator-fee default, and historical single-EOA governance on non-Polygon chains. Historical deployed-address/tx evidence belongs in knowledge-vault / deployment registries.

The v1.3 `ipCreator` parameter/event field is intentionally retained for ABI compatibility and to make the zero creator leg explicit. `ipCreatorBps` is immutable and production-valid only at `0`; removing the parameter is deferred to a future versioned ABI, not done silently in v1.3.
