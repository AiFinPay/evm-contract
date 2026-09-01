import { network } from "hardhat";
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
  routeIdsV14,
} from "./v14-production-config.js";

const { ethers, networkName } = await network.create();

/**
 * Deploys B2BSplitter v1.4 (signed, multi-route, RBAC) with satellite
 * TokenList and Profiles contracts.
 *
 * Governance is pure AccessControl. The deployer EOA receives ADMIN_ROLE at
 * construction, then is expected to grant ADMIN_ROLE to the TimelockController
 * (deployed via deploy-timelock.ts) and revoke its own role.
 *
 * Required env:
 *   AIFINPAY_SAFE_<chainId>      — Gnosis Safe / TimelockController admin
 *   AIFINPAY_TREASURY_<chainId>  — treasury (defaults to admin)
 *   AIFINPAY_V14_SIGNER          — backend KMS public key for SIGN_OPERATOR_ROLE
 *   AIFINPAY_PAUSER_<chainId>    — optional; defaults to the governance admin (Safe)
 */
const ZERO = ethers.ZeroAddress;

async function main() {
  const { chainId } = await getDeployerInfo(ethers, networkName);
  const networkCfg = V14_PRODUCTION_NETWORKS[chainId];
  if (!networkCfg) throw new Error(`No v1.4 production config for chainId ${chainId}.`);

  const gov = governanceEnv(chainId);
  const signer = initialSignerEnv();
  const pauser = pauserEnv(chainId, gov.admin);

  const usdc = configuredStableAddress(chainId, "USDC");
  const usdt = configuredStableAddress(chainId, "USDT");

  // Ensure governance and signer are non-zero.
  if (gov.admin === ZERO) throw new Error("Admin cannot be address(0).");
  if (signer === ZERO) throw new Error("Signer cannot be address(0).");
  if (pauser === ZERO) throw new Error("Pauser cannot be address(0).");
  if (gov.admin.toLowerCase() === signer.toLowerCase()) {
    throw new Error("ADMIN and SIGNER must be different addresses (separation of duties).");
  }
  if (pauser.toLowerCase() === signer.toLowerCase()) {
    throw new Error("PAUSER and SIGNER must be different addresses (separation of duties).");
  }

  const { agent, merchant } = await routeIdsV14();
  const stablecoins = [usdc, usdt].filter((t) => t !== ZERO);
  if (stablecoins.length === 0) {
    console.log("Warning: no stablecoins configured for this chain; native-only settlement.");
  }

  console.log(`\n${networkCfg.name}`);
  console.log(`Constructor args:`);
  console.log(`  initialAdmin = ${gov.admin}`);
  console.log(`  initialSigner = ${signer}`);
  console.log(`  initialPauser = ${pauser}`);
  console.log(`  treasury = ${gov.treasury}`);
  console.log(`  stablecoins = ${stablecoins.join(", ") || "(none)"}`);
  console.log(`  routeIds = agent, merchant`);
  console.log(`  treasuryBps = 0, 100`);
  console.log(`  ipCreatorBps = 0, 0`);

  const Factory = await ethers.getContractFactory("B2BSplitterV14");
  const splitter = await Factory.deploy({
    initialAdmin: gov.admin,
    initialSigner: signer,
    initialPauser: pauser,
    treasury: gov.treasury,
    stablecoins,
    routeIds: [agent, merchant],
    treasuryBps: [0, 100],
    ipCreatorBps: [0, 0],
  });

  console.log(`\nDeploy tx: ${splitter.deploymentTransaction()?.hash}`);
  await splitter.waitForDeployment();
  const addr = await splitter.getAddress();
  const runtimeCodeHash = await computeRuntimeCodeHash(ethers, addr);

  const tokenListAddr = await splitter.tokenList();
  const profilesAddr = await splitter.profiles();

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
    registryEntryStaged: {
      chainId,
      version: "1.4",
      splitter: addr,
      tokenList: tokenListAddr,
      profiles: profilesAddr,
      runtimeCodeHash,
      treasury: gov.treasury,
      routes: {
        agent: { treasuryBps: 0, ipCreatorBps: 0, enabled: true },
        merchant: { treasuryBps: 100, ipCreatorBps: 0, enabled: true },
      },
      enabled: false,
    },
  };

  writeDeploymentRecord(networkName, chainId, record, "v14-latest");

  console.log(`\n✅ B2BSplitterV14 deployed: ${addr}`);
  console.log(`   tokenList  = ${tokenListAddr}`);
  console.log(`   profiles   = ${profilesAddr}`);
  console.log(`   runtimeCodeHash = ${runtimeCodeHash}`);
  console.log(`   treasury   = ${await splitter.treasury()}`);

  console.log(`\nPost-deploy governance transfer (run after TimelockController deploy):`);
  console.log(`   splitter.grantRole(ADMIN_ROLE, timelockController)`);
  console.log(`   splitter.renounceRole(ADMIN_ROLE, deployer)`);
  console.log(`   (PAUSER_ROLE is held by ${pauser} and can pause instantly if needed)`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
