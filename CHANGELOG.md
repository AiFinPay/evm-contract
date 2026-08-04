# Changelog

## Unreleased

- Security: replaced the Polygon-only print script with a manifest-driven,
  fail-closed deployment verifier.
- Deployment: added chain/config/code/stablecoin-decimal preflight, confirmed
  wiring and ownership receipts, multisig ownership transfer, exclusive
  manifest creation, and post-deploy read-back verification.
- Tests: added positive and negative deployment-verifier coverage for wiring,
  governance, chain identity, code presence, and configuration mismatch.
