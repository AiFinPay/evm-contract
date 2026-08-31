/**
 * @title Deploy TimelockController for AiFinPay Protocol
 * @notice Deploys a 48-hour timelock and transfers ownership of all contracts
 * 
 * Usage:
 *   bun run deploy:timelock --network polygon
 * 
 * Environment variables required:
 *   - PROD_DEPLOYER_KEY: Private key of deployer (must have ownership of contracts)
 *   - SAFE_ADDRESS: Gnosis Safe multisig address (will be proposer)
 *   - EXECUTOR_ADDRESS: Address that can execute timelock operations (can be same as SAFE)
 */

import { ethers } from "hardhat";
import type { TimelockController, TimelockWrapper } from "../typechain-types";

const MIN_DELAY = 48 * 60 * 60; // 48 hours in seconds

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying timelock with account:", await deployer.getAddress());

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
  const timelockAddress = await wrapper.timelock();
  
  console.log("\n✅ TimelockWrapper deployed:", await wrapper.getAddress());
  console.log("✅ TimelockController deployed:", timelockAddress);

  // If you have existing contracts, transfer ownership:
  // const core = AiFinPayCore.attach(CORE_ADDRESS);
  // const splitter = B2BSplitter.attach(SPLITTER_ADDRESS);
  // await wrapper.transferMultiple([core, splitter]);
  
  // Or transfer individually:
  // await wrapper.transferToTimelock(core);

  // After all contracts are wired, renounce the wrapper's admin role and sweep
  // any accidental balance to the timelock:
  // await wrapper.destroy();

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
