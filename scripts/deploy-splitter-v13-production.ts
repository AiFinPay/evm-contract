import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";
import { DeploymentRecord } from "./lib/types.js";
import {
  PRODUCTION_EVM_NETWORKS,
  ZERO_ADDRESS,
  configuredStableAddress,
  governanceEnv,
} from "../config/v13-production-config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { ethers, networkName } = await network.create();

const FEE_PROFILES: Record<string, { treasuryBps: number; ipCreatorBps: number; description: string }> = {
  "agent-x402": {
    treasuryBps: 0,
    ipCreatorBps: 0,
    description: "AIFP-2/x402 — provider gets 100% of gross; AiFinPay percentage fee 0%.",
  },
  "merchant-aifp1": {
    treasuryBps: 100,
    ipCreatorBps: 0,
    description: "AIFP-1 — merchant gets 99% of gross; AiFinPay treasury gets 1%; creator 0%.",
  },
};

const SAFE_ABI = [
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
] as const;

function feeProfile() {
  const name = process.env.FEE_PROFILE?.trim();
  if (!name || !FEE_PROFILES[name]) {
    throw new Error(`FEE_PROFILE must be one of: ${Object.keys(FEE_PROFILES).join(", ")}`);
  }
  return { name, ...FEE_PROFILES[name] };
}

async function assertContractAddress(label: string, address: string): Promise<string> {
  const normalized = ethers.getAddress(address);
  const code = await ethers.provider.getCode(normalized);
  if (code === "0x") throw new Error(`${label} ${normalized} has no code on ${networkName}`);
  return normalized;
}

async function inspectSafe(label: string, raw: string) {
  const address = await assertContractAddress(label, raw);
  const safe = new ethers.Contract(address, SAFE_ABI, ethers.provider);
  let owners: string[];
  let threshold: number;
  try {
    owners = (await safe.getOwners()).map((value: string) => ethers.getAddress(value));
    threshold = Number(await safe.getThreshold());
  } catch (error) {
    throw new Error(`${label} ${address} does not expose the required Safe getOwners()/getThreshold() interface: ${String(error)}`);
  }
  const uniqueOwners = new Set(owners.map((value) => value.toLowerCase()));
  if (owners.length < 2 || uniqueOwners.size !== owners.length) {
    throw new Error(`${label} ${address} must have at least 2 unique Safe owners; observed ${owners.length}`);
  }
  if (!Number.isInteger(threshold) || threshold < 2 || threshold > owners.length) {
    throw new Error(`${label} ${address} has unsafe/invalid threshold ${threshold} for ${owners.length} owners; production requires threshold >= 2`);
  }
  return { address, owners, threshold };
}

async function inspectStable(symbol: "USDC" | "USDT", raw: string) {
  if (!raw || raw.toLowerCase() === ZERO_ADDRESS) {
    return { address: ethers.ZeroAddress, decimals: null as number | null, symbol: null as string | null };
  }
  const address = await assertContractAddress(symbol, raw);
  const token = new ethers.Contract(
    address,
    ["function decimals() view returns (uint8)", "function symbol() view returns (string)"],
    ethers.provider,
  );
  const decimals = Number(await token.decimals());
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(`${symbol} ${address} returned invalid decimals=${decimals}`);
  }
  let chainSymbol: string | null = null;
  try { chainSymbol = String(await token.symbol()); } catch { /* old tokens may omit string symbol */ }
  return { address, decimals, symbol: chainSymbol };
}

async function main() {
  const profile = feeProfile();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const cfg = PRODUCTION_EVM_NETWORKS[chainId];
  if (!cfg) throw new Error(`chainId ${chainId} is not one of AiFinPay's 9 production EVM networks`);

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No PROD_DEPLOYER_KEY configured for this network");
  const balance = await ethers.provider.getBalance(deployer.address);
  if (balance === 0n) throw new Error(`Deployer ${deployer.address} has zero native balance`);

  const govRaw = governanceEnv(chainId);
  const ownerSafe = await inspectSafe("Safe owner", govRaw.owner);
  const treasurySafe = govRaw.treasury.toLowerCase() === govRaw.owner.toLowerCase()
    ? ownerSafe
    : await inspectSafe("treasury Safe", govRaw.treasury);
  const owner = ownerSafe.address;
  const treasury = treasurySafe.address;

  const usdc = await inspectStable("USDC", configuredStableAddress(chainId, "USDC"));
  const usdt = await inspectStable("USDT", configuredStableAddress(chainId, "USDT"));

  console.log(`AiFinPay B2BSplitter v1.3 production deployment`);
  console.log(`network=${cfg.name} chainId=${chainId} hardhat=${networkName}`);
  console.log(`deployer=${deployer.address}`);
  console.log(`owner=${owner} threshold=${ownerSafe.threshold} owners=${ownerSafe.owners.join(",")}`);
  console.log(`treasury=${treasury} threshold=${treasurySafe.threshold} owners=${treasurySafe.owners.join(",")}`);
  console.log(`profile=${profile.name} treasuryBps=${profile.treasuryBps} creatorBps=${profile.ipCreatorBps}`);
  console.log(`USDC=${usdc.address} decimals=${usdc.decimals ?? "unsupported"} symbol=${usdc.symbol ?? "n/a"}`);
  console.log(`USDT=${usdt.address} decimals=${usdt.decimals ?? "unsupported"} symbol=${usdt.symbol ?? "n/a"}`);

  if (process.env.CONFIRM_MAINNET_DEPLOY !== `${chainId}:${profile.name}`) {
    throw new Error(
      `Refusing mainnet deployment. Set CONFIRM_MAINNET_DEPLOY=${chainId}:${profile.name} after reviewing the values above.`,
    );
  }

  const Factory = await ethers.getContractFactory("B2BSplitterV13");
  const splitter = await Factory.deploy(
    owner,
    treasury,
    usdc.address,
    usdt.address,
    profile.treasuryBps,
    profile.ipCreatorBps,
  );
  const tx = splitter.deploymentTransaction();
  if (!tx) throw new Error("Deployment transaction missing");
  console.log(`deployTx=${tx.hash}`);
  await splitter.waitForDeployment();
  const address = await splitter.getAddress();

  const runtimeCode = await ethers.provider.getCode(address);
  if (runtimeCode === "0x") throw new Error(`No runtime code at deployed address ${address}`);
  const runtimeCodeHash = ethers.keccak256(runtimeCode);

  const actual = {
    owner: await splitter.owner(),
    treasury: await splitter.treasury(),
    usdc: await splitter.USDC(),
    usdt: await splitter.USDT(),
    treasuryBps: Number(await splitter.treasuryBps()),
    ipCreatorBps: Number(await splitter.ipCreatorBps()),
  };
  const mismatches = [
    actual.owner.toLowerCase() === owner.toLowerCase() || "owner",
    actual.treasury.toLowerCase() === treasury.toLowerCase() || "treasury",
    actual.usdc.toLowerCase() === usdc.address.toLowerCase() || "USDC",
    actual.usdt.toLowerCase() === usdt.address.toLowerCase() || "USDT",
    actual.treasuryBps === profile.treasuryBps || "treasuryBps",
    actual.ipCreatorBps === profile.ipCreatorBps || "ipCreatorBps",
  ].filter((x) => x !== true);
  if (mismatches.length) throw new Error(`Post-deploy constructor mismatch: ${mismatches.join(", ")}`);

  const timestamp = new Date().toISOString();
  const deploymentsDir = path.join(__dirname, "../deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const record: DeploymentRecord & Record<string, unknown> = {
    network: networkName,
    chainId,
    timestamp,
    splitterVersion: "1.3",
    route: profile.name,
    deploymentTx: tx.hash,
    splitter: {
      address,
      owner,
      treasury,
      usdc: usdc.address,
      usdt: usdt.address,
    },
    governance: {
      ownerSafe: { address: owner, owners: ownerSafe.owners, threshold: ownerSafe.threshold },
      treasurySafe: { address: treasury, owners: treasurySafe.owners, threshold: treasurySafe.threshold },
    },
    tokenDecimals: { usdc: usdc.decimals, usdt: usdt.decimals },
    tokenSymbolsObserved: { usdc: usdc.symbol, usdt: usdt.symbol },
    runtimeCodeHash,
    economics: {
      grossInclusive: true,
      treasuryBps: profile.treasuryBps,
      ipCreatorBps: profile.ipCreatorBps,
      immutable: true,
      description: profile.description,
    },
    registryEntryStaged: {
      chainId,
      route: profile.name,
      version: "1.3",
      splitter: address,
      runtimeCodeHash,
      treasury,
      usdc: usdc.address,
      usdt: usdt.address,
      treasuryBps: profile.treasuryBps,
      ipCreatorBps: profile.ipCreatorBps,
      enabled: false,
    },
  };
  const safeTs = timestamp.replace(/[:.]/g, "-");
  const basename = `${networkName}-v13-${profile.name}`;
  fs.writeFileSync(path.join(deploymentsDir, `${basename}-${safeTs}.json`), JSON.stringify(record, null, 2) + "\n");
  fs.writeFileSync(path.join(deploymentsDir, `${basename}-latest.json`), JSON.stringify(record, null, 2) + "\n");

  console.log(`DEPLOYED ${profile.name}: ${address}`);
  console.log(`runtimeCodeHash=${runtimeCodeHash}`);
  console.log(`registry.enabled=false (mandatory until explorer verification + paid E2E)`);
  console.log(`verify command:`);
  console.log(
    `npx hardhat verify --network ${networkName} ${address} ${owner} ${treasury} ${usdc.address} ${usdt.address} ${profile.treasuryBps} ${profile.ipCreatorBps}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
