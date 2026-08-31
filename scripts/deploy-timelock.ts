/**
 * @title Deploy TimelockController for AiFinPay Protocol
 * @notice Deploys a 48-hour timelock and records wrapper + controller addresses.
 *
 * Usage:
 *   bun run deploy:timelock --network polygon
 *
 * Environment variables required:
 *   - PROD_DEPLOYER_KEY: Private key of deployer
 *   - SAFE_ADDRESS: Gnosis Safe multisig address (will be proposer)
 *   - EXECUTOR_ADDRESS: Address that can execute timelock operations (can be same as SAFE)
 */

import { ethers } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { TimelockWrapper } from "../typechain-types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIN_DELAY = 48 * 60 * 60; // 48 hours in seconds

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const networkName = (await ethers.provider.getNetwork()).name;
  console.log("Deploying timelock with account:", deployerAddress);

  // Get addresses from environment or use defaults
  const safeAddress = process.env.SAFE_ADDRESS;
  const executorAddress = process.env.EXECUTOR_ADDRESS || safeAddress;

  if (!safeAddress) {
    throw new Error("SAFE_ADDRESS environment variable is required");
  }

  console.log("Proposer (Safe):", safeAddress);
  console.log("Executor:", executorAddress);
  console.log("Minimum delay:", MIN_DELAY / 3600, "hours");

  // Deploy TimelockWrapper
  const TimelockWrapperFactory = await ethers.getContractFactory("TimelockWrapper");
  const wrapper = await TimelockWrapperFactory.deploy(
    safeAddress,
    executorAddress,
    MIN_DELAY
  ) as unknown as TimelockWrapper;

  await wrapper.waitForDeployment();
  const wrapperAddress = await wrapper.getAddress();
  const timelockAddress = await wrapper.timelock();
  const runtimeCodeHash = ethers.keccak256(await ethers.provider.getCode(wrapperAddress));

  console.log("\n✅ TimelockWrapper deployed:", wrapperAddress);
  console.log("✅ TimelockController deployed:", timelockAddress);

  // Legacy Ownable targets:
  // await wrapper.transferToTimelock(Ownable.attach(CORE_ADDRESS));
  // RBAC v1.4+ targets:
  // await wrapper.grantRoleToTimelock(IAccessControl.attach(SPLITTER_V14), ADMIN_ROLE);
  // await wrapper.renounceRoleOnTarget(IAccessControl.attach(SPLITTER_V14), ADMIN_ROLE);

  // Record deployment
  const timestamp = new Date().toISOString();
  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });
  const safeTs = timestamp.replace(/[:.]/g, "-");

  const record = {
    network: networkName,
    chainId,
    timestamp,
    timelock: {
      wrapper: wrapperAddress,
      controller: timelockAddress,
      proposer: safeAddress,
      executor: executorAddress,
      minDelay: MIN_DELAY,
      runtimeCodeHash,
    },
  };
  const payload = JSON.stringify(record, null, 2) + "\n";
  fs.writeFileSync(path.join(deploymentsDir, `${networkName}-timelock-${safeTs}.json`), payload);
  fs.writeFileSync(path.join(deploymentsDir, `${networkName}-timelock-latest.json`), payload);

  console.log("\n⏰ Timelock is now active!");
  console.log("All privileged operations require", MIN_DELAY / 3600, "hour delay");
  console.log("Proposer (Safe) can schedule operations");
  console.log("Executor can execute scheduled operations");
  console.log("Call wrapper.destroy() after wiring to renounce its admin role");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
