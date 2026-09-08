import { network } from "hardhat";
import { DeploymentRecord } from "./lib/types.js";
import {
  computeRuntimeCodeHash,
  getDeployerInfo,
  writeDeploymentRecord,
} from "./lib/deployment.js";
import {
  canonicalSalt,
  deployDirect,
  deployViaCreate3,
  resolveCreate3Factory,
} from "./lib/create3.js";
import { routeDeploymentConfigV14, routeIdsV14 } from "../config/v14-production-config.js";

const { ethers, networkName } = await network.create();

/**
 * Local-only B2BSplitterV14 deployment for the `default` EDR network.
 *
 * Deploys two MockERC20 tokens as USDC/USDT stand-ins and uses the deployer as
 * the admin, signer, pauser, and treasury. This is intentionally relaxed compared
 * to the production script and is meant for local integration tests only.
 */
async function main() {
  const feeProfile = process.env.FEE_PROFILE || "agent-x402";
  if (!["agent-x402", "merchant-aifp1"].includes(feeProfile)) {
    throw new Error(`Unknown FEE_PROFILE "${feeProfile}"`);
  }

  const feeConfig = { agentTreasuryBps: 0, merchantTreasuryBps: 100, ipCreatorBps: 0 };

  const { chainId } = await getDeployerInfo(ethers, networkName);

  const [deployer, signer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const signerAddress = await signer.getAddress();

  console.log("\nStep 1/4: Deploying local stand-ins (not via CREATE3)...");

  const USDC = await ethers.getContractFactory("MockERC20");
  const usdc = await USDC.deploy("Local USDC", "USDC", 6);
  await usdc.waitForDeployment();
  const usdcAddr = await usdc.getAddress();
  console.log(`  USDC           = ${usdcAddr}`);

  const USDT = await ethers.getContractFactory("MockERC20");
  const usdt = await USDT.deploy("Local USDT", "USDT", 6);
  await usdt.waitForDeployment();
  const usdtAddr = await usdt.getAddress();
  console.log(`  USDT           = ${usdtAddr}`);

  const { routeIds, treasuryBps, ipCreatorBps } = routeDeploymentConfigV14();
  const { agent, merchant } = routeIdsV14();

  console.log("\nStep 2/4: Resolving CREATE3 factory...");
  const create3Factory = await resolveCreate3Factory(ethers, networkName);
  console.log(`  CREATE3Factory = ${create3Factory}`);

  console.log("\nStep 3/4: Deploying v1.4 contracts via CREATE3...");
  console.log(`  Satellite admin = ${deployerAddress}`);
  console.log("  Deterministic addresses are derived from the deployer + salt; constructor");
  console.log("  arguments do not affect the deployed address.");

  const { address: tokenListAddr, predicted: predictedTokenList } = await deployViaCreate3(
    ethers,
    create3Factory,
    "TokenList",
    canonicalSalt(deployerAddress, "TokenList", "1.0"),
    [deployerAddress, [usdcAddr, usdtAddr]],
  );
  console.log(`  TokenList      = ${tokenListAddr} (predicted ${predictedTokenList})`);

  const { address: profilesAddr, predicted: predictedProfiles } = await deployViaCreate3(
    ethers,
    create3Factory,
    "Profiles",
    canonicalSalt(deployerAddress, "Profiles", "1.0"),
    [deployerAddress, routeIds, treasuryBps, ipCreatorBps],
  );
  console.log(`  Profiles       = ${profilesAddr} (predicted ${predictedProfiles})`);

  console.log("\nConstructor args:");
  console.log(`  initialAdmin   = ${deployerAddress}`);
  console.log(`  initialSigner  = ${signerAddress}`);
  console.log(`  initialPauser  = ${deployerAddress}`);
  console.log(`  treasury       = ${deployerAddress}`);
  console.log(`  tokenList      = ${tokenListAddr}`);
  console.log(`  profiles       = ${profilesAddr}`);

  const splitterArgs = [
    {
      initialAdmin: deployerAddress,
      initialSigner: signerAddress,
      initialPauser: deployerAddress,
      treasury: deployerAddress,
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
    canonicalSalt(deployerAddress, "B2BSplitterV14", "1.4"),
    splitterArgs,
  );
  console.log(`  Splitter       = ${addr} (predicted ${predictedSplitter})`);
  console.log(`\nDeploy tx: ${splitter.deploymentTransaction()?.hash}`);

  const runtimeCodeHash = await computeRuntimeCodeHash(ethers, addr);

  // Satellites are administered directly by the deployer; splitter no longer proxies writes.

  const record: Omit<DeploymentRecord, "network" | "chainId" | "timestamp"> &
    Record<string, unknown> = {
    network: networkName,
    chainId,
    splitterVersion: "1.4",
    feeProfile,
    splitter: {
      address: addr,
      admin: deployerAddress,
      signer: signerAddress,
      pauser: deployerAddress,
      treasury: deployerAddress,
      tokenList: tokenListAddr,
      profiles: profilesAddr,
      usdc: usdcAddr,
      usdt: usdtAddr,
    },
    runtimeCodeHash,
    tokenDecimals: { usdc: 6, usdt: 6 },
    registryEntryStaged: {
      chainId,
      version: "1.4",
      splitter: addr,
      tokenList: tokenListAddr,
      profiles: profilesAddr,
      runtimeCodeHash,
      treasury: deployerAddress,
      feeProfile,
      routes: {
        agent: {
          treasuryBps: feeConfig.agentTreasuryBps,
          ipCreatorBps: feeConfig.ipCreatorBps,
          enabled: true,
        },
        merchant: {
          treasuryBps: feeConfig.merchantTreasuryBps,
          ipCreatorBps: feeConfig.ipCreatorBps,
          enabled: true,
        },
      },
      enabled: false,
    },
  };

  writeDeploymentRecord(networkName, chainId, record, "v14-local-latest");

  const agentProfile = await profiles.getProfile(agent);
  const merchantProfile = await profiles.getProfile(merchant);

  if (
    Number(agentProfile.treasuryBps) !== feeConfig.agentTreasuryBps ||
    Number(agentProfile.ipCreatorBps) !== feeConfig.ipCreatorBps ||
    !agentProfile.enabled ||
    Number(merchantProfile.treasuryBps) !== feeConfig.merchantTreasuryBps ||
    Number(merchantProfile.ipCreatorBps) !== feeConfig.ipCreatorBps ||
    !merchantProfile.enabled
  ) {
    throw new Error(
      `Deployed route profile does not match expected. Agent: ${agentProfile.treasuryBps}/${agentProfile.ipCreatorBps}/${agentProfile.enabled}; ` +
        `Merchant: ${merchantProfile.treasuryBps}/${merchantProfile.ipCreatorBps}/${merchantProfile.enabled}.`,
    );
  }

  console.log(`\n✅ B2BSplitterV14 (local) deployed: ${addr}`);
  console.log(`   tokenList       = ${tokenListAddr}`);
  console.log(`   profiles        = ${profilesAddr}`);
  console.log(`   runtimeCodeHash = ${runtimeCodeHash}`);
  console.log(`   treasury()      = ${await splitter.treasury()}`);
  console.log(
    `   route agent     = ${agentProfile.treasuryBps}/${agentProfile.ipCreatorBps}, enabled=${agentProfile.enabled}`,
  );
  console.log(
    `   route merchant  = ${merchantProfile.treasuryBps}/${merchantProfile.ipCreatorBps}, enabled=${merchantProfile.enabled}`,
  );
  console.log(
    "\n⚠️  Local deployment only — not verified and not safe to enable in production registries.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
