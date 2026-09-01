import { network } from "hardhat";
import { DeploymentRecord } from "./lib/types.js";
import {
  computeRuntimeCodeHash,
  getDeployerInfo,
  writeDeploymentRecord,
} from "./lib/deployment.js";
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

  console.log("\nDeploying local stand-ins...");

  const [deployer, signer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const signerAddress = await signer.getAddress();

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

  const { routeIds, treasuryBps, ipCreatorBps } = await routeDeploymentConfigV14();
  const { agent, merchant } = await routeIdsV14();

  console.log("\nConstructor args:");
  console.log(`  initialAdmin   = ${deployerAddress}`);
  console.log(`  initialSigner  = ${signerAddress}`);
  console.log(`  initialPauser  = ${deployerAddress}`);
  console.log(`  treasury       = ${deployerAddress}`);
  console.log(`  stablecoins    = [${usdcAddr}, ${usdtAddr}]`);
  console.log(`  routeIds       = agent, merchant`);
  console.log(`  treasuryBps    = [${treasuryBps.join(", ")}]`);
  console.log(`  ipCreatorBps   = [${ipCreatorBps.join(", ")}]`);

  const factory = await ethers.getContractFactory("B2BSplitterV14");
  const splitter = await factory.deploy({
    initialAdmin: deployerAddress,
    initialSigner: signerAddress,
    initialPauser: deployerAddress,
    treasury: deployerAddress,
    stablecoins: [usdcAddr, usdtAddr],
    routeIds,
    treasuryBps,
    ipCreatorBps,
  });

  console.log(`\nDeploy tx: ${splitter.deploymentTransaction()?.hash}`);
  await splitter.waitForDeployment();
  const addr = await splitter.getAddress();

  const runtimeCodeHash = await computeRuntimeCodeHash(ethers, addr);

  const tokenListAddr = await splitter.tokenList();
  const profilesAddr = await splitter.profiles();
  const profiles = await ethers.getContractAt("Profiles", profilesAddr);

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
