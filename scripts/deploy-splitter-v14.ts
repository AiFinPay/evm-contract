/**
 * Deploys B2BSplitter v1.4 to production networks using explicit governance env.
 * This script never falls back to the deployer EOA and aborts if any required
 * env is missing.
 *
 * Env files:
 *   - amoy network: .env.testnet
 *   - all other networks: .env.production
 */
import { config as dotenvConfig } from "dotenv";
import { ZeroAddress } from "ethers";

// Load the correct env file BEFORE importing hardhat, so the network config
// (accounts, RPC, etc.) picks up the values.
dotenvConfig({ path: ".env" });
const networkArgIndex = process.argv.indexOf("--network");
const selectedNetwork = networkArgIndex >= 0 ? process.argv[networkArgIndex + 1] : "polygon";
const envFile = selectedNetwork === "amoy" ? ".env.testnet" : ".env.production";
dotenvConfig({ path: envFile, override: true });
console.log(`Loaded env file: ${envFile}`);

const { network } = await import("hardhat");
import { DeploymentRecord } from "./lib/types.js";
import {
  computeRuntimeCodeHash,
  getDeployerInfo,
  writeDeploymentRecord,
} from "./lib/deployment.js";
import {
  V14_PRODUCTION_NETWORKS,
  configuredStableAddress,
  governanceEnv,
  initialSignerEnv,
  pauserEnv,
  routeDeploymentConfigV14,
} from "../config/v14-production-config.js";

const { ethers, networkName } = await network.create();

async function main() {
  console.log("Step 1/9: Loading deployer and network info...");
  const { chainId, address: deployerAddress } = await getDeployerInfo(ethers, networkName);
  const networkCfg = V14_PRODUCTION_NETWORKS[chainId];
  if (!networkCfg) throw new Error(`No v1.4 config for chainId ${chainId}.`);

  console.log(`Network: ${networkName} (chainId ${chainId})`);
  console.log(`Deployer: ${deployerAddress}`);

  console.log("\nStep 2/9: Resolving governance addresses from env...");
  const gov = governanceEnv(chainId);
  const signer = initialSignerEnv();
  const pauser = pauserEnv(chainId, gov.admin);
  console.log(`  Admin   = ${gov.admin}`);
  console.log(`  Signer  = ${signer}`);
  console.log(`  Pauser  = ${pauser}`);
  console.log(`  Treasury = ${gov.treasury}`);

  console.log("\nStep 3/9: Validating governance addresses...");
  if (gov.admin === ZeroAddress) throw new Error("Admin cannot be address(0).");
  if (signer === ZeroAddress) throw new Error("Signer cannot be address(0).");
  if (pauser === ZeroAddress) throw new Error("Pauser cannot be address(0).");
  if (gov.admin.toLowerCase() === signer.toLowerCase()) {
    throw new Error("ADMIN and SIGNER must be different addresses.");
  }
  if (pauser.toLowerCase() === signer.toLowerCase()) {
    throw new Error("PAUSER and SIGNER must be different addresses.");
  }
  console.log("  Governance addresses are valid.");

  console.log("\nStep 4/9: Resolving route and stablecoin configuration...");
  const { routeIds, treasuryBps, ipCreatorBps } = routeDeploymentConfigV14();
  const usdc = configuredStableAddress(chainId, "USDC");
  const usdt = configuredStableAddress(chainId, "USDT");
  const stablecoins = [usdc, usdt].filter((t) => t !== ZeroAddress);
  console.log(`  USDC       = ${usdc}`);
  console.log(`  USDT       = ${usdt}`);
  console.log(`  Stablecoins used = [${stablecoins.join(", ")}]`);
  console.log(`  Routes     = [${routeIds.join(", ")}]`);
  console.log(`  Treasury bps = [${treasuryBps.join(", ")}]`);
  console.log(`  IP creator bps = [${ipCreatorBps.join(", ")}]`);

  console.log("\nStep 5/9: Deploying v1.4 satellite contracts...");
  console.log(`  Satellite admin will be set to governance address: ${gov.admin}`);

  const TokenListFactory = await ethers.getContractFactory("TokenList");
  const tokenList = await TokenListFactory.deploy(gov.admin, stablecoins);
  await tokenList.waitForDeployment();
  const tokenListAddr = await tokenList.getAddress();
  console.log(`  TokenList  = ${tokenListAddr}`);

  const ProfilesFactory = await ethers.getContractFactory("Profiles");
  const profiles = await ProfilesFactory.deploy(gov.admin, routeIds, treasuryBps, ipCreatorBps);
  await profiles.waitForDeployment();
  const profilesAddr = await profiles.getAddress();
  console.log(`  Profiles   = ${profilesAddr}`);

  console.log("\nStep 6/9: Deploying B2BSplitterV14...");
  const Factory = await ethers.getContractFactory("B2BSplitterV14");
  const splitter = await Factory.deploy({
    initialAdmin: gov.admin,
    initialSigner: signer,
    initialPauser: pauser,
    treasury: gov.treasury,
    tokenList: tokenListAddr,
    profiles: profilesAddr,
  });

  console.log(`  Deploy tx  = ${splitter.deploymentTransaction()?.hash}`);
  await splitter.waitForDeployment();
  const addr = await splitter.getAddress();
  console.log(`  Splitter   = ${addr}`);

  console.log("\nStep 7/9: Computing runtime code hash...");
  const runtimeCodeHash = await computeRuntimeCodeHash(ethers, addr);
  console.log(`  Runtime code hash = ${runtimeCodeHash}`);

  console.log(
    "\nStep 8/9: Satellites are administered directly by governance; no admin transfer to splitter needed.",
  );

  console.log("\nStep 9/9: Writing deployment record...");
  const record: Omit<DeploymentRecord, "network" | "chainId" | "timestamp"> &
    Record<string, unknown> = {
    network: networkName,
    chainId,
    splitterVersion: "1.4",
    splitter: {
      address: addr,
      admin: gov.admin,
      signer,
      pauser,
      treasury: gov.treasury,
      tokenList: tokenListAddr,
      profiles: profilesAddr,
      usdc,
      usdt,
    },
    runtimeCodeHash,
  };

  const { latest } = writeDeploymentRecord(
    networkName,
    chainId,
    record,
    `v14-${networkName}-latest`,
  );
  console.log(`  Deployment record written to ${latest}`);

  console.log(`\n✅ B2BSplitterV14 ${networkName} deployed: ${addr}`);
  console.log(`   tokenList  = ${tokenListAddr}`);
  console.log(`   profiles   = ${profilesAddr}`);
  console.log(`   runtimeCodeHash = ${runtimeCodeHash}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
