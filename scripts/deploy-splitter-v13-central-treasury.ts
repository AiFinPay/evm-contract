import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";
import { PRODUCTION_EVM_NETWORKS, ZERO_ADDRESS, configuredStableAddress, governanceEnv } from "./v13-production-config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { ethers, networkName } = await network.create();

const BASE_CHAIN_ID = 8453;
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const SAFE_ABI = [
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
] as const;
const FEE_PROFILES = {
  "agent-x402": { treasuryBps: 0, ipCreatorBps: 0 },
  "merchant-aifp1": { treasuryBps: 100, ipCreatorBps: 0 },
} as const;

type FeeProfileName = keyof typeof FEE_PROFILES;

function requiredAddress(name: string): string {
  const raw = process.env[name]?.trim();
  if (!raw) throw new Error(`${name} is required`);
  const address = ethers.getAddress(raw);
  if (address === ethers.ZeroAddress) throw new Error(`${name} cannot be zero`);
  return address;
}

async function inspectSafe(provider: any, label: string, raw: string) {
  const address = ethers.getAddress(raw);
  const code = await provider.getCode(address);
  if (code === "0x") throw new Error(`${label} ${address} has no contract code`);
  const safe = new ethers.Contract(address, SAFE_ABI, provider);
  const owners = (await safe.getOwners()).map((value: string) => ethers.getAddress(value));
  const threshold = Number(await safe.getThreshold());
  const unique = new Set(owners.map((v: string) => v.toLowerCase()));
  if (owners.length < 2 || unique.size !== owners.length) throw new Error(`${label} must have at least 2 unique owners`);
  if (!Number.isInteger(threshold) || threshold < 2 || threshold > owners.length) {
    throw new Error(`${label} has invalid/unsafe threshold ${threshold}/${owners.length}`);
  }
  return { address, owners, threshold };
}

async function inspectStable(symbol: "USDC" | "USDT", raw: string) {
  if (!raw || raw.toLowerCase() === ZERO_ADDRESS) return { address: ethers.ZeroAddress, decimals: null as number | null };
  const address = ethers.getAddress(raw);
  const code = await ethers.provider.getCode(address);
  if (code === "0x") throw new Error(`${symbol} ${address} has no code on ${networkName}`);
  const token = new ethers.Contract(address, ["function decimals() view returns (uint8)"], ethers.provider);
  const decimals = Number(await token.decimals());
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error(`${symbol} decimals are invalid`);
  return { address, decimals };
}

async function verifyCentralBaseSafe(address: string) {
  const baseRpc = process.env.BASE_RPC?.trim() || process.env.BASE_RPC_URL?.trim();
  if (!baseRpc) throw new Error("BASE_RPC or BASE_RPC_URL is required to verify the central Base Safe");
  const provider = new ethers.JsonRpcProvider(baseRpc, BASE_CHAIN_ID);
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== BASE_CHAIN_ID) throw new Error(`Central treasury RPC must be Base chainId ${BASE_CHAIN_ID}`);
  return inspectSafe(provider, "Central Base treasury Safe", address);
}

async function main() {
  const profileName = process.env.FEE_PROFILE?.trim() as FeeProfileName | undefined;
  if (!profileName || !(profileName in FEE_PROFILES)) throw new Error("FEE_PROFILE must be agent-x402 or merchant-aifp1");
  const profile = FEE_PROFILES[profileName];
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const cfg = PRODUCTION_EVM_NETWORKS[chainId];
  if (!cfg) throw new Error(`Unsupported AiFinPay production EVM chainId ${chainId}`);

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No production deployer configured");
  const deployerAddress = ethers.getAddress(deployer.address);
  if ((await ethers.provider.getBalance(deployerAddress)) === 0n) throw new Error("Production deployer has zero native balance");

  const governance = governanceEnv(chainId);
  const ownerSafe = await inspectSafe(ethers.provider, "Governance Safe", governance.owner);
  const collector = requiredAddress("AIFINPAY_TREASURY_COLLECTOR_EVM");
  if (collector.toLowerCase() === deployerAddress.toLowerCase()) {
    throw new Error("Operational treasury collector must not be the deployment EOA");
  }
  const centralSafeAddress = requiredAddress("AIFINPAY_CENTRAL_TREASURY_SAFE_BASE");
  const centralSafe = await verifyCentralBaseSafe(centralSafeAddress);

  // AIFP-2 has no protocol fee. Keeping the collector in the immutable
  // constructor is harmless but no treasury transfer occurs under 0/0.
  const treasury = collector;
  const usdc = await inspectStable("USDC", configuredStableAddress(chainId, "USDC"));
  const usdt = await inspectStable("USDT", configuredStableAddress(chainId, "USDT"));

  console.log("AiFinPay v1.3 central-treasury deployment preflight");
  console.log(`network=${cfg.name} chainId=${chainId} route=${profileName}`);
  console.log(`deployer=${deployerAddress}`);
  console.log(`ownerSafe=${ownerSafe.address} threshold=${ownerSafe.threshold}`);
  console.log(`operationalCollector=${collector}`);
  console.log(`centralBaseSafe=${centralSafe.address} threshold=${centralSafe.threshold}`);
  console.log(`centralAsset=USDC ${BASE_USDC}`);
  console.log(`USDC=${usdc.address} USDT=${usdt.address}`);

  if (process.env.CONFIRM_MAINNET_DEPLOY !== `${chainId}:${profileName}:central-treasury`) {
    throw new Error(`Refusing mainnet deployment. Set CONFIRM_MAINNET_DEPLOY=${chainId}:${profileName}:central-treasury after reviewing preflight output.`);
  }

  const Factory = await ethers.getContractFactory("B2BSplitterV13");
  const splitter = await Factory.deploy(
    ownerSafe.address,
    treasury,
    usdc.address,
    usdt.address,
    profile.treasuryBps,
    profile.ipCreatorBps,
  );
  const deploymentTx = splitter.deploymentTransaction();
  if (!deploymentTx) throw new Error("Missing deployment transaction");
  await splitter.waitForDeployment();
  const address = await splitter.getAddress();
  const runtimeCode = await ethers.provider.getCode(address);
  if (runtimeCode === "0x") throw new Error("Deployed splitter has no runtime code");
  const runtimeCodeHash = ethers.keccak256(runtimeCode);

  const actual = {
    owner: ethers.getAddress(await splitter.owner()),
    treasury: ethers.getAddress(await splitter.treasury()),
    usdc: ethers.getAddress(await splitter.USDC()),
    usdt: ethers.getAddress(await splitter.USDT()),
    treasuryBps: Number(await splitter.treasuryBps()),
    ipCreatorBps: Number(await splitter.ipCreatorBps()),
  };
  if (actual.owner !== ownerSafe.address || actual.treasury !== collector || actual.usdc !== usdc.address || actual.usdt !== usdt.address
      || actual.treasuryBps !== profile.treasuryBps || actual.ipCreatorBps !== profile.ipCreatorBps) {
    throw new Error(`Post-deploy readback mismatch: ${JSON.stringify(actual)}`);
  }

  const record = {
    status: "DEPLOYED_DISABLED",
    network: networkName,
    chainId,
    splitterVersion: "1.3",
    route: profileName,
    deploymentTx: deploymentTx.hash,
    splitter: address,
    runtimeCodeHash,
    sourceCommit: process.env.SOURCE_COMMIT || "MUST_BE_PINNED_BY_RELEASE",
    governance: ownerSafe,
    treasury: {
      mode: "OPERATIONAL_COLLECTOR_TO_CENTRAL_SAFE",
      collector,
      centralNetwork: "base",
      centralChainId: BASE_CHAIN_ID,
      centralSafe: centralSafe.address,
      centralSafeOwners: centralSafe.owners,
      centralSafeThreshold: centralSafe.threshold,
      centralAsset: "USDC",
      centralAssetAddress: BASE_USDC,
      sweepExecution: "ASYNC_AFTER_SETTLEMENT",
    },
    assets: { USDC: usdc, USDT: usdt },
    economics: profile,
    settlementEnabled: false,
    e2eVerified: false,
    timestamp: new Date().toISOString(),
  };

  const dir = path.join(__dirname, "../deployments/central-treasury");
  fs.mkdirSync(dir, { recursive: true });
  const output = path.join(dir, `${chainId}-${profileName}.json`);
  fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify(record, null, 2));
  console.log(`evidence=${output}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
