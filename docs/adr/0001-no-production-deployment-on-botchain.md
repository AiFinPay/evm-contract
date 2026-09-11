# ADR-0001: No production deployment on BOT Chain

**Date**: 2026-09-11
**Status**: accepted
**Deciders**: AiFinPay protocol team

## Context

AiFinPay v1.4 is designed to settle business-to-business payments across EVM networks. Each supported mainnet must provide reliable gas-token access, liquid stablecoins, verified contract infrastructure, and a clear legal counterparty. BOT Chain (chain ID 677) was evaluated as a candidate mainnet because it is EVM-compatible and advertised for AI agents and DePIN use cases. A CertiK audit exists, but the project has not yet met the operational bar required for a payment settlement chain.

## Decision

AiFinPay will **not deploy production v1.4 contracts to BOT Chain** at this time. BOT Chain may remain in the Hardhat network list and Safe-network configuration for monitoring or future testnet work, but no production B2BSplitterV14, TokenList, Profiles, or Timelock contracts will be deployed, and BOT Chain will not be marked `settlementEnabled` in the SDK registry.

## Alternatives Considered

### Alternative 1: Deploy to BOT Chain with minimal stablecoin support
- **Pros**: Expands network coverage; aligns with AI/DePIN marketing positioning.
- **Cons**: No verified stablecoin issuer contracts, unclear gas-token liquidity, and no Safe transaction service.
- **Why not**: Payment settlement requires deep liquidity and audited token contracts. BOT Chain cannot guarantee either today.

### Alternative 2: Deploy only to testnet and wait for mainnet maturity
- **Pros**: Low risk, preserves optionality, allows monitoring of network stability.
- **Cons**: Delays potential user reach on BOT Chain.
- **Why not**: This is the chosen path. The chain remains configured but inactive for production.

## Consequences

### Positive
- Avoids exposing merchants and payers to an immature chain.
- Keeps the protocol's risk surface aligned with chains that have verified stablecoins and Safe infrastructure.
- Prevents reputational damage from failed settlements or inaccessible gas tokens.

### Negative
- AiFinPay will not serve BOT Chain users until the chain matures.
- Engineering time spent on BOT Chain integration (RPC, chain descriptors, Safe config) is held in reserve rather than activated.

### Risks
- **Risk**: BOT Chain improves and a competitor deploys first, capturing market share.
- **Mitigation**: The chain remains in configuration, so a future deployment only requires a governance vote and stablecoin verification.
- **Risk**: Stale configuration rots if not revisited.
- **Mitigation**: ADR is linked from `docs/V14_MIGRATION.md` and will be reviewed quarterly or whenever BOT Chain token liquidity/audit status changes.

## Evidence summary

- BOT Chain has public GitHub repos, a block explorer, and a CertiK audit with 19 findings (3 major, several acknowledged). Team verification, KYC, and bug bounty are not present on the CertiK page.
- The native gas token (BOT) is difficult to acquire. The bridge supports only USDT, and there is no clear, reputable exchange or verified token contract for BOT.
- CertiK lists market cap and token launch date as unavailable, indicating no liquid, established market.
- Official marketing claims (institutional-grade security, investor backing) are project-made and not independently verified.

## References

- BOT Chain website and explorer.
- CertiK BOT Chain assessment page.
- Internal due-diligence note: "Is BOT Chain a scam?" review, 2026-09-11.
