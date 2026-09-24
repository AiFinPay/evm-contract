import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import hre from "hardhat";
import { verifyContract } from "@nomicfoundation/hardhat-verify/verify";
import type { VerifyContractArgs } from "@nomicfoundation/hardhat-verify/verify";
import type { DeploymentRecord, SplitterV14Deployment } from "./types.js";
import type { NetworkConnection } from "hardhat/dist/src/types/network";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findDeploymentRecords(network: string): DeploymentRecord[] {
  const deploymentsDir = path.join(__dirname, "../../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    return [];
  }

  const records: DeploymentRecord[] = [];
  const candidates = [
    `${network}-v14-${network}-latest.json`,
    `${network}-v14-latest.json`,
    `${network}-v14-production-latest.json`,
    `${network}-latest.json`,
  ];
  for (const file of candidates) {
    const p = path.join(deploymentsDir, file);
    if (fs.existsSync(p)) {
      records.push(JSON.parse(fs.readFileSync(p, "utf8")) as DeploymentRecord);
    }
  }
  return records;
}

function readDeployment(network: string): DeploymentRecord {
  const records = findDeploymentRecords(network);
  if (records.length === 0) {
    throw new Error(
      `No v1.4 deployment record found for network "${network}". Run deploy or create the file first.`,
    );
  }
  return records[0];
}

async function verifyOne(
  args: VerifyContractArgs,
  label: string,
  provider?: string,
): Promise<void> {
  console.log(`\nVerifying ${label} at ${args.address}...`);
  try {
    await verifyContract({ ...args, provider: provider as VerifyContractArgs["provider"] }, hre);
    console.log(`✅ ${label} verified.`);
  } catch (error: any) {
    if (error?.message?.includes("already been verified")) {
      console.log(`ℹ️  ${label} already verified.`);
    } else if (error?.message?.includes("is already verified")) {
      console.log(`ℹ️  ${label} already verified.`);
    } else {
      console.error(`❌ ${label} verification failed:`, error?.message ?? error);
      throw error;
    }
  }
}

function routeId(name: string, ethers: NetworkConnection<"generic">["ethers"]): string {
  return ethers.keccak256(ethers.toUtf8Bytes(name));
}

async function verifyTokenList(
  _splitter: SplitterV14Deployment,
  ethers: NetworkConnection<"generic">["ethers"],
  provider?: string,
): Promise<void> {
  const initialTokens = _splitter.stablecoins
    .map((s) => s.address)
    .filter((a) => a && a !== ethers.ZeroAddress);
  await verifyOne(
    {
      address: _splitter.tokenList,
      constructorArgs: [_splitter.admin, initialTokens],
      contract: "contracts/TokenList.sol:TokenList",
    },
    "TokenList",
    provider,
  );
}

async function verifyProfiles(
  _splitter: SplitterV14Deployment,
  ethers: NetworkConnection<"generic">["ethers"],
  provider?: string,
): Promise<void> {
  // Profiles constructor args are not stored in the record. We derive the
  // canonical v1.4 route configuration from the hard-coded bootstrap routes
  // used during deployment.
  const routeIds = [routeId("agent-x402", ethers), routeId("merchant-aifp1", ethers)];
  const treasuryBps = [0, 100];
  const ipCreatorBps = [0, 0];

  await verifyOne(
    {
      address: _splitter.profiles,
      constructorArgs: [_splitter.admin, routeIds, treasuryBps, ipCreatorBps],
      contract: "contracts/Profiles.sol:Profiles",
    },
    "Profiles",
    provider,
  );
}

async function verifySplitterV14(
  _splitter: SplitterV14Deployment,
  provider?: string,
): Promise<void> {
  // v1.4 constructor is a struct: ConstructorParams
  const constructorArgs = [
    {
      initialAdmin: _splitter.admin,
      initialSigner: _splitter.signer,
      initialPauser: _splitter.pauser,
      treasury: _splitter.treasury,
      tokenList: _splitter.tokenList,
      profiles: _splitter.profiles,
    },
  ];

  await verifyOne(
    {
      address: _splitter.address,
      constructorArgs,
      contract: "contracts/B2BSplitterV14.sol:B2BSplitterV14",
    },
    "B2BSplitterV14",
    provider,
  );
}

/**
 * Chain IDs whose explorer is Blockscout (not Etherscan-compatible). For these
 * networks, hardhat-verify must be told to use the blockscout provider so it
 * does not fall back to the unified Etherscan v2 API.
 */
const BLOCKSCOUT_CHAIN_IDS = new Set<number>([4663]);

/**
 * Verify all v1.4 contracts from a deployment record.
 *
 * Order matters: TokenList and Profiles must be verified before B2BSplitterV14
 * because explorers may need library/dependency bytecode for transitive source
 * matching. In practice each contract is independent, but we keep satellites
 * first for consistency.
 */
export async function verifyV14Deployment(
  record: DeploymentRecord,
  ethers: NetworkConnection<"generic">["ethers"],
): Promise<void> {
  if (!record.splitter) {
    throw new Error("No v1.4 splitter deployment found in record.");
  }
  const splitter = record.splitter;
  const provider = BLOCKSCOUT_CHAIN_IDS.has(record.chainId) ? "blockscout" : undefined;

  await verifyTokenList(splitter, ethers, provider);
  await verifyProfiles(splitter, ethers, provider);
  await verifySplitterV14(splitter, provider);
}

/**
 * CLI entry: read the latest deployment record for the current network and
 * verify TokenList, Profiles, and B2BSplitterV14.
 */
export async function runVerifyFromRecord(
  networkName: string,
  ethers: NetworkConnection<"generic">["ethers"],
): Promise<void> {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  console.log(`Verifying on ${networkName} (chainId ${chainId})`);

  const record = readDeployment(networkName);
  if (record.chainId !== chainId) {
    throw new Error(
      `Deployment record chainId (${record.chainId}) does not match current network (${chainId}).`,
    );
  }

  if (record.splitterVersion && record.splitterVersion !== "1.4") {
    console.warn(`Deployment record splitter version is ${record.splitterVersion}; expected 1.4.`);
  }

  await verifyV14Deployment(record, ethers);
}
