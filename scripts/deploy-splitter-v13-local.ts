import { network } from "hardhat";
import { computeRuntimeCodeHash, getDeployerInfo, writeDeploymentRecord } from "./lib/deployment.js";

const { ethers, networkName } = await network.create();

/**
 * Local-only B2BSplitterV13 deployment for the `default` EDR network.
 *
 * Deploys two MockERC20 tokens as USDC/USDT stand-ins and uses a mock owner
 * contract (a Multicall3-like stub) so the splitter's owner-must-be-contract
 * invariant holds during local integration tests.
 *
 * This script is intentionally separate from the production v1.3 deploy:
 * it relaxes governance requirements and skips source verification.
 */

/** Minimal bytecode for a contract that simply returns on any call.
 *  Used as the owner/treasury stub so getCode() returns non-empty.
 */
const STUB_BYTECODE = "0x6080604052348015600e575f80fd5b50607780601a5f395ff3fe";

async function deployStubContract(name: string): Promise<string> {
  const [deployer] = await ethers.getSigners();
  const tx = await deployer.sendTransaction({ data: STUB_BYTECODE });
  const receipt = await tx.wait();
  const addr = receipt?.contractAddress;
  if (!addr) throw new Error(`Failed to deploy ${name} stub contract`);
  console.log(`  ${name} stub = ${addr}`);
  return addr;
}

async function main() {
  const feeProfile = process.env.FEE_PROFILE || "agent-x402";
  if (!["agent-x402", "merchant-aifp1"].includes(feeProfile)) {
    throw new Error(`Unknown FEE_PROFILE "${feeProfile}"`);
  }

  const fee =
    feeProfile === "agent-x402"
      ? { treasuryBps: 0, ipCreatorBps: 0, note: "x402 agent route (0/0)" }
      : { treasuryBps: 100, ipCreatorBps: 0, note: "merchant monetisation route (100/0)" };

  const { chainId } = await getDeployerInfo(ethers, networkName);

  console.log("\nDeploying local stand-ins...");
  const owner = await deployStubContract("owner/treasury");

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

  console.log("\nConstructor args:");
  console.log(`  owner          = ${owner}`);
  console.log(`  treasury       = ${owner}`);
  console.log(`  stablecoins    = [${usdcAddr}, ${usdtAddr}]`);
  console.log(`  treasuryBps    = ${fee.treasuryBps}`);
  console.log(`  ipCreatorBps   = ${fee.ipCreatorBps}`);

  const Factory = await ethers.getContractFactory("B2BSplitterV13");
  const splitter = await Factory.deploy({
    initialOwner: owner,
    treasury: owner,
    stablecoins: [usdcAddr, usdtAddr],
    treasuryBps: fee.treasuryBps,
    ipCreatorBps: fee.ipCreatorBps,
  });
  console.log(`\nDeploy tx: ${splitter.deploymentTransaction()?.hash}`);
  await splitter.waitForDeployment();
  const addr = await splitter.getAddress();

  const runtimeCodeHash = await computeRuntimeCodeHash(ethers, addr);

  const onChainTreasuryBps = Number(await splitter.treasuryBps());
  const onChainIpCreatorBps = Number(await splitter.ipCreatorBps());
  if (onChainTreasuryBps !== fee.treasuryBps || onChainIpCreatorBps !== fee.ipCreatorBps) {
    throw new Error(
      `Deployed split does not match profile: chain reports ${onChainTreasuryBps}/${onChainIpCreatorBps}, ` +
        `expected ${fee.treasuryBps}/${fee.ipCreatorBps}.`,
    );
  }

  const record = {
    network: networkName,
    chainId,
    splitterVersion: "1.3",
    feeProfile,
    splitter: {
      address: addr,
      owner,
      treasury: owner,
      usdc: usdcAddr,
      usdt: usdtAddr,
    },
    runtimeCodeHash,
    tokenDecimals: { usdc: 6, usdt: 6 },
    registryEntryStaged: {
      chainId,
      version: "1.3",
      splitter: addr,
      runtimeCodeHash,
      treasury: owner,
      feeProfile,
      treasuryBps: onChainTreasuryBps,
      ipCreatorBps: onChainIpCreatorBps,
      enabled: false,
    },
  };

  writeDeploymentRecord(networkName, chainId, record, "v13-local-latest");

  console.log(`\n✅ B2BSplitterV13 (local) deployed: ${addr}`);
  console.log(`   runtimeCodeHash = ${runtimeCodeHash}`);
  console.log(`   USDC whitelist  = ${await splitter.whitelistedTokens(usdcAddr)}`);
  console.log(`   USDT whitelist  = ${await splitter.whitelistedTokens(usdtAddr)}`);
  console.log(`   treasury()      = ${await splitter.treasury()}`);
  console.log(`   owner()         = ${await splitter.owner()}`);
  console.log(`   treasuryBps     = ${onChainTreasuryBps}, ipCreatorBps = ${onChainIpCreatorBps}`);
  console.log("\n⚠️  Local deployment only — not verified and not safe to enable in production registries.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
