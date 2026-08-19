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
bun test                   # hardhat test mocha (153 tests in the current suite)
bun run lint               # solhint 'contracts/**/*.sol'
bun run prettify:check     # prettier --check 'contracts/**/*.sol'
bun run prettify           # prettier --write 'contracts/**/*.sol'
forge test                 # foundry tests (15 tests with 256 fuzz runs each)
```

## Testing
- **Hardhat/Mocha**: `bun test` (153 integration tests)
- **Foundry**: `forge test` (15 tests with fuzzing)
- **Single test**: `bun test --grep "test name"` or `forge test --match-test testName`
- **Gas reports**: `forge test --gas-report`
- See `docs/TESTING_GUIDE.md` for complete testing documentation

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

### Standard Deployment (No Timelock)
1. Ensure `config/chains/<network>.json` exists with `pyth`, `usdc`, `usdt`, `nativeUsdId`, and `treasury`.
2. `bun run deploy` (or `bun run deploy:testnet` for Amoy) deploys `MSECCOToken` → `AgentPassport` → `AiFinPayCore`, wires `setCore()`, and writes a deployment record to `deployments/<network>.json`.
3. `bun run verify --network <network>` reads the deployment record and source-verifies all recorded contracts on the configured block explorer.
4. Transfer ownership of all contracts to the Gnosis Safe.
5. Update `CLAUDE.md` canonical addresses.

### Deployment with Timelock (Recommended for Production)

**Prerequisites:**
- Gnosis Safe deployed and configured
- 48-hour timelock delay for governance security
- See `docs/TIMELOCK_SETUP.md` for detailed guide

**Step 1: Deploy Core Contracts**
```bash
# Deploy to testnet first
bun run deploy:testnet
bun run verify --network amoy

# Deploy to mainnet
bun run deploy
bun run verify --network polygon
```

**Step 2: Deploy B2BSplitter**
```bash
bun run deploy:splitter
bun run verify --network polygon
```

**Step 3: Deploy Timelock**
```bash
# Set environment variables
export SAFE_ADDRESS=0xYourGnosisSafeAddress
export EXECUTOR_ADDRESS=0xExecutorAddress  # Can be same as SAFE

# Deploy timelock (48h delay)
bun run deploy:timelock --network polygon
```

**Step 4: Transfer Ownership**
Edit `scripts/deploy-timelock.ts` and uncomment:
```typescript
await wrapper.transferMultiple([core, splitter, splitterV13]);
```

Then run:
```bash
bun run deploy:timelock --network polygon
```

**Step 5: Verify Ownership**
```bash
cast owner $CORE_ADDRESS --rpc-url $RPC_URL
# Should return TimelockController address
```

**Step 6: Update Documentation**
- Update `CLAUDE.md` with timelock address
- Update `deployments/<network>.json` with timelock address
- Announce to community

`B2BSplitter` is deployed separately via `bun run deploy:splitter` (`scripts/deploy-splitter-v12.ts`); the splitter record is appended to `deployments/<network>.json` and verified by the same `bun run verify --network <network>` command. Current canonical is `0xE34Fc0E6694821c600Fa0955C0F74720ea6d8440`.

## Verify command
```bash
bun run verify --network polygon   # production (default)
bun run verify --network amoy      # testnet
```
Requires `ETHERSCAN_API_KEY` (or legacy `POLYGONSCAN_API_KEY`) in `.env`. The script uses the canonical constructor arguments from the deployment record and chain config, so no manual address/argument assembly is needed.

## Timelock deployment
```bash
export SAFE_ADDRESS=0xYourSafeAddress
export EXECUTOR_ADDRESS=0xExecutorAddress
bun run deploy:timelock --network polygon
```
Deploys a 48-hour TimelockController and transfers ownership of all contracts. See `docs/TIMELOCK_SETUP.md` for complete workflow.

## Dependency security
- `package.json` contains `overrides` that force patched transitive versions where needed. Running `bun install` after editing overrides regenerates `bun.lock`.
- A low-risk transitive advisory remains (reported by `bun audit`) because it is pinned by Ethers v6 / Hardhat v3 and cannot be resolved without a major toolchain migration:
  - `elliptic <=6.6.1` — no newer release exists.

## Canonical source of truth
- `hardhat.config.ts` is the authoritative network/verification config.

## Security & Governance
- **Timelock**: 48-hour delay on all privileged operations (fees, treasury, pause)
- **Multisig**: Gnosis Safe is the timelock proposer
- **Fee caps**: Hard-coded maximums (treasury: 5%, IP creator: 1%)
- **Oracle safety**: Pyth confidence validation (2% threshold)
- See `docs/SECURITY_AUDIT.md` for complete security documentation
