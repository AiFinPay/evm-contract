# Agent Instructions — AiFinPay EVM Contracts

Primary instructions: `node_modules/@daochild/agents-config/AGENTS.md` — read in full and follow unless overridden below.

## Package manager
- Use **Bun** only. `package-lock.json` was removed; the lockfile is `bun.lock`.
- Setup: `bun install`
- Required Node version: `22.13.0+` (Hardhat 3 requirement).

## Day-to-day commands
```bash
bun run build              # hardhat compile contracts
bun test                   # hardhat test mocha
bun run lint               # solhint 'contracts/**/*.sol'
bun run prettify:check     # prettier --check 'contracts/**/*.sol'
bun run prettify           # prettier --write 'contracts/**/*.sol'
forge test                 # foundry tests (default 256 fuzz runs each)
```

## CI order
```text
bun install → bun run build → bun test → bun run lint → bun run prettify:check
```
No separate typecheck step; Hardhat/TypeScript compilation is exercised during `build` and `test`. Foundry is **not** in the current CI order.

## Toolchain quirks
- **Hardhat v3.x**, **Ethers.js v6**, **Mocha**, **Chai 5**, **TypeScript 5.9**, ESM `"type": "module"`, `NodeNext` resolution.
- **Solidity `0.8.35`**, EVM target `cancun`, optimizer `viaIR: true`, `runs: 10000`.
- **Tests and scripts must create a network connection** before using `ethers`:
  ```ts
  import { network } from "hardhat";
  const { ethers, networkHelpers } = await network.create();
  ```
  See `test/fixtures.ts` for the canonical pattern.
- `loadFixture` now lives on `networkHelpers` (not `@nomicfoundation/hardhat-toolbox/network-helpers`). Import `{ ethers, loadFixture }` from `./fixtures` in tests.
- Revert assertions use the Hardhat 3 matcher:
  - `.to.revert(ethers)` / `.not.to.revert(ethers)` (any revert)
  - `.to.be.revertedWith(...)` (revert reason string)
  - `.to.be.revertedWithCustomError(contract, "ErrorName")` (custom error)
- **Type generation**: `bun run build` writes `typechain-types/`. Tests import generated types from `typechain-types`.
- **Network configs live in `hardhat.config.ts`** and `config/chains/<network>.json`. Production deploys primarily use `polygon` and `amoy`; registry pins addresses for 10+ chains.
- **`dotenv` is loaded by `hardhat.config.ts`** — place `.env` at repo root.

## Testing
- **Hardhat/Mocha**: `bun test` (integration-heavy suite in `test/`).
- **Foundry**: `forge test` (math + timelock invariants in `foundry-tests/`).
- **Single test**: `bun test --grep "test name"` or `forge test --match-test testName`.
- **Gas reports**: `forge test --gas-report`.
- Fixtures are in `test/fixtures.ts`: deploys `MockPyth`, `MSECCOToken`, `AgentPassport`, `AiFinPayCore`, then wires `setCore()`.
- See `docs/TESTING_GUIDE.md` for full testing documentation.

## Code style (enforced)
- **Solidity only**: 4-space indentation, 120-char line limit, trailing commas none. Prettier overrides for `.sol` are in `.prettierrc`.
- Function args prefixed with `_`; NatSpec `@param` names must match.
- No raw `IERC20.transfer` / `transferFrom`; always use `SafeERC20`.
- `STABLE_DECIMALS_DIVISOR = 10_000` is the canonical USDC/USDT → mSECCO conversion.
- mSECCO is non-transferable; Passport is soulbound (only mint allowed in `_beforeTokenTransfer`).
- `setCore()` is one-way on all contracts.

## Environment variables for deploy/verify
- Testnets: `DEV_DEPLOYER_KEY`
- Mainnets: `PROD_DEPLOYER_KEY`
- Verification: `ETHERSCAN_API_KEY` (unified Etherscan v2) or legacy `POLYGONSCAN_API_KEY`.
- RPC overrides: `POLYGON_MAINNET_RPC`, `AMOY_RPC`, etc. — all have fallbacks.
- `.env` files must **never** be committed (`.aiignore` + `.opencode/opencode.json` deny rules already in place).

## Deployment flow
Deploy scripts default to the `production` build profile (`--build-profile production`).

### Core contracts
```bash
bun run deploy          # polygon
bun run deploy:testnet  # amoy
```
This deploys `MSECCOToken` → `AgentPassport` → `AiFinPayCore`, wires `setCore()`, and writes `deployments/<network>-latest.json`.

### B2BSplitter v1.3
```bash
bun run deploy:splitter  # polygon
```
Records the splitter in `deployments/<network>-latest.json`; verify picks it up automatically.

### Verify
```bash
bun run verify --network polygon
bun run verify --network amoy
```
Reads `deployments/<network>-latest.json` and source-verifies all recorded contracts. The core `AiFinPayCore` constructor args come from the deployment record plus `config/chains/<network>.json`.

### Timelock (production governance)
```bash
export SAFE_ADDRESS=0xYourGnosisSafeAddress
export EXECUTOR_ADDRESS=0xExecutorAddress   # can be same as SAFE
bun run deploy:timelock --network polygon
```
See `docs/TIMELOCK_SETUP.md` for the complete workflow. After transfer, `cast owner $CORE_ADDRESS` should return the TimelockController address.

## Registry / SDK addresses
- Canonical route registry: `registry/registry.json`. Never hand-edit `registry/generated/splitter-table.json` — it is generated from `registry/registry.json` by `scripts/generate-sdk-table.mjs` and CI fails on drift.
- `settlementEnabled` is deliberately `false` on all mainnet v1.3 entries until a paid end-to-end settlement is verified on that exact route.
- Testnet Amoy routes are `settlementEnabled: true` and owned by the deployer key, not the Safe.

## Canonical sources of truth
- `hardhat.config.ts`: authoritative network/verification/compiler config.
- `foundry.toml`: separate Foundry build profile (`contracts/`, `foundry-tests/`, `foundry-artifacts/`).
- `registry/registry.json`: canonical SDK payment targets and governance Safe.
- `README.md`: canonical deployed addresses for Polygon mainnet.

## Security & Governance
- **Timelock**: 48-hour delay on all privileged operations (fees, treasury, pause).
- **Multisig**: Gnosis Safe is the timelock proposer (`0xFd936f75D9221949f2FEaB54Cd342F7527154eD5`).
- **Fee caps**: hard-coded maximums (treasury 5%, IP creator 1%).
- **Oracle safety**: Pyth confidence validation (2% threshold).
- See `docs/SECURITY_AUDIT.md` and `docs/ARCHITECTURE.md` for full documentation.

## Dependency security
- `package.json` contains `overrides` that force patched transitive versions. Run `bun install` after editing overrides to regenerate `bun.lock`.
- A low-risk transitive advisory remains (`elliptic <=6.6.1`) because it is pinned by Ethers v6 / Hardhat v3 and cannot be resolved without a major toolchain migration.
