# Timelock Governance Model

<!-- governance-status: direct-safe -->

`TimelockWrapper` deploys a `TimelockController` with a minimum delay of 48 hours. Deploying these contracts does not transfer any target roles. A target is timelock-governed only after its `DEFAULT_ADMIN_ROLE` is assigned to the controller and removed from other admin holders.

The v1.4 admin-controlled targets are `B2BSplitterV14`, `TokenList`, and `Profiles`. The Polygon v1.4 deployment record lists the Gnosis Safe as the splitter admin; no Polygon timelock deployment record is present in this repository. Verify role assignments on chain before describing a target as timelock-protected.

See [TIMELOCK_SETUP.md](./TIMELOCK_SETUP.md) for deployment, role-transfer, and verification steps.
