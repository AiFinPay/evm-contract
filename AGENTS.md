# Agent Instructions — AiFinPay EVM Contracts

Primary instructions are located at:
- node_modules/@daochild/agents-config/AGENTS.md

Follow all instructions from that file unless overridden below.

## Package manager
- Use **Bun** only. `package-lock.json` was removed; the lockfile is `bun.lock`.
- Setup: `bun install`

## Day-to-day commands
```bash
bun run build              # hardhat build (compile contracts)
bun test                   # hardhat test mocha (138 tests in the current suite)
bun run lint               # solhint 'contracts/**/*.sol'
bun run prettify:check     # prettier --check 'contracts/**/*.sol'
bun run prettify           # prettier --write 'contracts/**/*.sol'
```

## CI order
CI runs: `bun install` → `bun run build` → `bun test` → `bun run lint` → `bun run prettify:check`.
No separate typecheck step; Hardhat/TypeScript compilation is exercised during `build` and `test`.

## Toolchain quirks
- **Hardhat v3.x**, **Ethers.js v6**, **Mocha**, **Chai 5**, **TypeScript 5.9**, ESM/`"type": "module"`, `NodeNext` resolution.
- **Solidity `0.8.35`**, EVM target `cancun`, optimizer `viaIR: true`, `runs: 200`.
- **Tests and scripts must create a network connection** before using `ethers`:
  ```ts
  import { network } from "hardhat";
  const { ethers, networkHelpers } = await network.create();
  ```
  See `test/fixtures.ts` for the canonical pattern.
- `loadFixture` now lives on `networkHelpers` (not `@nomicfoundation/hardhat-toolbox/network-helpers`).
- Revert assertions use the Hardhat 3 matcher:
  - `.to.revert(ethers)` / `.not.to.revert(ethers)` (any revert)
  - `.to.be.revertedWith(...)` (revert reason string)
  - `.to.be.revertedWithCustomError(contract, "ErrorName")` (custom error)
- **Type generation**: `hardhat build` writes `typechain-types/`. These are committed/generated locally; tests import from `typechain-types`.
- **Network configs live in `hardhat.config.ts`**. Many chains are configured; production deploys primarily use `polygon` and `amoy`.
- **`dotenv` is loaded by Hardhat config** — place `.env` at repo root.
- Required env for deploy/verify:
  - Testnets: `DEV_DEPLOYER_KEY`
  - Mainnets: `PROD_DEPLOYER_KEY`
  - Verification: `ETHERSCAN_API_KEY` (unified Etherscan v2) or legacy `POLYGONSCAN_API_KEY`.
- Deploy scripts default to the `production` build profile (`--build-profile production`).

## Running a single test
```bash
bun test --grep "agent pays merchant"   # or the relevant describe/it string
```
Tests live under `test/`. The fixture in `test/fixtures.ts` deploys `MockPyth`, `MSECCOToken`, `AgentPassport`, and `AiFinPayCore`, then wires them.

## Code style (enforced)
- **Solidity only**: 4-space indentation, 120-char line limit, trailing commas none.
  Prettier overrides for `.sol` are in `.prettierrc`.
- Function args prefixed with `_`; NatSpec `@param` names must match.
- No raw `IERC20.transfer` / `transferFrom`; always use `SafeERC20`.
- `STABLE_DECIMALS_DIVISOR = 10_000` is the canonical USDC/USDT → mSECCO conversion.
- mSECCO is non-transferable; Passport is soulbound (only mint allowed in `_beforeTokenTransfer`).
- `setCore()` is one-way on all contracts.

## Deployment flow
1. Ensure `config/chains/<network>.json` exists with `pyth`, `usdc`, `usdt`, `nativeUsdId`, and `treasury`.
2. `bun run deploy` (or `bun run deploy:testnet` for Amoy) deploys `MSECCOToken` → `AgentPassport` → `AiFinPayCore` and wires `setCore()`.
3. Verify printed Hardhat verify commands.
4. Transfer ownership of all contracts to the Gnosis Safe.
5. Update `CLAUDE.md` canonical addresses.

`B2BSplitter` is deployed separately via `bun run deploy:splitter` (`scripts/deploy-splitter-v12.ts`); current canonical is `0xE34Fc0E6694821c600Fa0955C0F74720ea6d8440`.

## Dependency security
- `package.json` contains `overrides` that force patched transitive versions where needed. Running `bun install` after editing overrides regenerates `bun.lock`.
- A low-risk transitive advisory remains (reported by `bun audit`) because it is pinned by Ethers v6 / Hardhat v3 and cannot be resolved without a major toolchain migration:
  - `elliptic <=6.6.1` — no newer release exists.

## Canonical source of truth
- `hardhat.config.ts` is the authoritative network/verification config.
