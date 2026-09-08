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
import { deployViaCreate3, resolveCreate3Factory } from "./lib/create3.js";
import {
  V14_PRODUCTION_NETWORKS,
  configuredSalt,
  configuredStableAddress,
  governanceEnv,
  initialSignerEnv,
  pauserEnv,
  routeDeploymentConfigV14,
} from "../config/v14-production-config.js";

const { ethers, networkName } = await network.create();

async function main() {
  console.log("Step 1/6: Loading deployer and network info...");
  const { chainId, address: deployerAddress } = await getDeployerInfo(ethers, networkName);
  const networkCfg = V14_PRODUCTION_NETWORKS[chainId];
  if (!networkCfg) throw new Error(`No v1.4 config for chainId ${chainId}.`);

  console.log(`Network: ${networkName} (chainId ${chainId})`);
  console.log(`Deployer: ${deployerAddress}`);

  console.log("\nStep 2/6: Resolving governance addresses from env...");
  const gov = governanceEnv(chainId);
  const signer = initialSignerEnv();
  const pauser = pauserEnv(chainId, gov.admin);
  console.log(`  Admin   = ${gov.admin}`);
  console.log(`  Signer  = ${signer}`);
  console.log(`  Pauser  = ${pauser}`);
  console.log(`  Treasury = ${gov.treasury}`);

  console.log("\nStep 3/6: Validating governance addresses...");
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

  console.log("\nStep 4/6: Resolving route and stablecoin configuration...");
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

  console.log("\nStep 5/6: Resolving CREATE3 factory...");
  const create3Factory = await resolveCreate3Factory(ethers, networkName);
  console.log(`  CREATE3Factory = ${create3Factory}`);

  console.log("\nStep 6/6: Deploying v1.4 contracts via CREATE3...");
  console.log(`  Satellite admin will be set to governance address: ${gov.admin}`);
  console.log("  Deterministic addresses are derived from the deployer + salt; constructor");
  console.log("  arguments do not affect the deployed address.");

  const { address: tokenListAddr, predicted: predictedTokenList } = await deployViaCreate3(
    ethers,
    create3Factory,
    "TokenList",
    configuredSalt(chainId, "TokenList", deployerAddress),
    [gov.admin, stablecoins],
  );
  console.log(`  TokenList  = ${tokenListAddr} (predicted ${predictedTokenList})`);

  const { address: profilesAddr, predicted: predictedProfiles } = await deployViaCreate3(
    ethers,
    create3Factory,
    "Profiles",
    configuredSalt(chainId, "Profiles", deployerAddress),
    [gov.admin, routeIds, treasuryBps, ipCreatorBps],
  );
  console.log(`  Profiles   = ${profilesAddr} (predicted ${predictedProfiles})`);

  console.log("\n  Deploying B2BSplitterV14...");
  const splitterArgs = [
    {
      initialAdmin: gov.admin,
      initialSigner: signer,
      initialPauser: pauser,
      treasury: gov.treasury,
      tokenList: tokenListAddr,
      profiles: profilesAddr,
    },
  ];
  const {
    address: addr,
    contract: splitter,
    predicted: predictedSplitter,
  } = await deployViaCreate3(
    ethers,
    create3Factory,
    "B2BSplitterV14",
    configuredSalt(chainId, "B2BSplitterV14", deployerAddress),
    splitterArgs,
  );

  console.log(`  Splitter   = ${addr} (predicted ${predictedSplitter})`);
  console.log(`  Deploy tx  = ${splitter.deploymentTransaction()?.hash}`);

  console.log("\n  Computing runtime code hash...");
  const runtimeCodeHash = await computeRuntimeCodeHash(ethers, addr);
  console.log(`  Runtime code hash = ${runtimeCodeHash}`);

  console.log(
    "\n  Satellites are administered directly by governance; no admin transfer to splitter needed.",
  );

  console.log("\n  Writing deployment record...");
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
