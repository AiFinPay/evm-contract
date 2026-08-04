# Deployment manifests

`verify-deployment.ts` reads `deployments/<hardhat-network>.json`, or the file
provided through `DEPLOYMENT_MANIFEST`. A production manifest must use schema
version 1 and declare the exact chain, contract addresses, multisig owner,
treasury, oracle, stablecoins, price feed, pause state, and fee configuration.

Verification fails on missing code, EOAs used as governance/treasury/oracle or
tokens, wiring/configuration mismatches, malformed manifests, and RPC errors.
It never converts missing evidence into a pass.

The deployment script writes a new manifest with exclusive-create semantics
only after code/config preflight, confirmed wiring and ownership transactions,
and a successful read-back verification. It refuses to overwrite an existing
manifest.
