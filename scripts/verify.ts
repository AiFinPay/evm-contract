import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import hre, { network } from "hardhat";
import { verifyContract } from "@nomicfoundation/hardhat-verify/verify";
import type { VerifyContractArgs } from "@nomicfoundation/hardhat-verify/verify";
import type { DeploymentRecord, SplitterV14Deployment } from "./lib/types.js";

const { ethers, networkName } = await network.create();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findDeploymentRecords(network: string): DeploymentRecord[] {
  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    return [];
  }

  const records: DeploymentRecord[] = [];
  const candidates = [
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

async function verifyOne(args: VerifyContractArgs, label: string): Promise<void> {
  console.log(`\nVerifying ${label} at ${args.address}...`);
  try {
    await verifyContract(args, hre);
    console.log(`✅ ${label} verified.`);
  } catch (error: any) {
    if (error?.message?.includes("already been verified")) {
      console.log(`ℹ️  ${label} already verified.`);
    } else {
      console.error(`❌ ${label} verification failed:`, error?.message ?? error);
      throw error;
    }
  }
}

function routeId(name: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(name));
}

async function verifyTokenList(_splitter: SplitterV14Deployment): Promise<void> {
  await verifyOne(
    {
      address: _splitter.tokenList,
      constructorArgs: [
        _splitter.admin,
        [_splitter.usdc, _splitter.usdt].filter((t) => t !== ethers.ZeroAddress),
      ],
      contract: "contracts/TokenList.sol:TokenList",
    },
    "TokenList",
  );
}

async function verifyProfiles(_splitter: SplitterV14Deployment): Promise<void> {
  // Profiles constructor args are not stored in the record. We derive the
  // canonical v1.4 route configuration from the hard-coded bootstrap routes
  // used during deployment.
  const routeIds = [routeId("agent-x402"), routeId("merchant-aifp1")];
  const treasuryBps = [0, 100];
  const ipCreatorBps = [0, 0];

  await verifyOne(
    {
      address: _splitter.profiles,
      constructorArgs: [_splitter.admin, routeIds, treasuryBps, ipCreatorBps],
      contract: "contracts/Profiles.sol:Profiles",
    },
    "Profiles",
  );
}

async function verifySplitterV14(_splitter: SplitterV14Deployment): Promise<void> {
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
  );
}

/**
 * Verify all v1.4 contracts from a deployment record.
 *
 * Order matters: TokenList and Profiles must be verified before B2BSplitterV14
 * because explorers may need library/dependency bytecode for transitive source
 * matching. In practice each contract is independent, but we keep satellites
 * first for consistency.
 */
export async function verifyV14Deployment(record: DeploymentRecord): Promise<void> {
  if (!record.splitter) {
    throw new Error("No v1.4 splitter deployment found in record.");
  }
  const splitter = record.splitter;

  await verifyTokenList(splitter);
  await verifyProfiles(splitter);
  await verifySplitterV14(splitter);
}

/**
 * CLI entry: read the latest deployment record for the current network and
 * verify TokenList, Profiles, and B2BSplitterV14.
 */
export async function runVerifyFromRecord(_networkName: string): Promise<void> {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  console.log(`Verifying on ${_networkName} (chainId ${chainId})`);

  const record = readDeployment(_networkName);
  if (record.chainId !== chainId) {
    throw new Error(
      `Deployment record chainId (${record.chainId}) does not match current network (${chainId}).`,
    );
  }

  if (record.splitterVersion && record.splitterVersion !== "1.4") {
    console.warn(`Deployment record splitter version is ${record.splitterVersion}; expected 1.4.`);
  }

  await verifyV14Deployment(record);
}

async function main() {
  await runVerifyFromRecord(networkName);
  console.log("\n=== VERIFICATION COMPLETE ===");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
