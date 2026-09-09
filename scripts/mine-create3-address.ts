/**
 * Off-chain vanity miner for CreateX-deployed v1.4 contracts.
 *
 * Usage:
 *   bun run scripts/mine-create3-address.ts --contract B2BSplitterV14 --prefix 0x00 --deployer 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266
 *
 * Defaults:
 *   - contract: B2BSplitterV14
 *   - version:  1.4
 *   - factory:  canonical CreateX 0xba5Ed...ba5Ed
 *   - deployer: first local Hardhat signer if omitted and network is default/localhost
 */
import { config as dotenvConfig } from "dotenv";
import { network } from "hardhat";
import {
  CREATEX_FACTORY_ADDRESS,
  mineSaltForPrefix,
  mineSaltForPostfix,
  mineSaltForPrefixAndPostfix,
  predictCreate3Address,
} from "./lib/create3.js";

dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env", override: false });

function parseArg(_name: string): string | undefined {
  const idx = process.argv.indexOf(_name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const { ethers, networkName } = await network.create();

const contractName = parseArg("--contract") || "B2BSplitterV14";
const version = parseArg("--version") || (contractName === "B2BSplitterV14" ? "1.4" : "1.0");
const prefix = parseArg("--prefix");
const postfix = parseArg("--postfix");
const maxAttempts = Number(parseArg("--max") || "1000000");
const start = Number(parseArg("--start") || "0");
const factory = parseArg("--factory") || CREATEX_FACTORY_ADDRESS;

function formatAttempts(_attempts: number): string {
  return _attempts.toLocaleString("en-US");
}

async function main() {
  if (!prefix && !postfix) {
    throw new Error(
      "Usage: bun run scripts/mine-create3-address.ts --prefix 0xABC [--postfix 0xXYZ] [--contract Name] [--deployer 0x...] [--factory 0x...] [--start N] [--max N]",
    );
  }

  const deployerAddress =
    parseArg("--deployer") ||
    (await (await ethers.getSigners())[0].getAddress()) ||
    "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

  console.log(`Mining ${contractName} ${version} address via CreateX ${factory}`);
  console.log(`Deployer: ${deployerAddress}`);
  if (prefix) console.log(`Target prefix: ${prefix.toLowerCase()}`);
  if (postfix) console.log(`Target postfix: ${postfix.toLowerCase()}`);
  console.log("");

  const startTime = Date.now();
  let result: { salt: string; guardedSalt: string; address: string; attempts: number };

  if (prefix && postfix) {
    result = mineSaltForPrefixAndPostfix(
      factory,
      deployerAddress,
      contractName,
      version,
      prefix,
      postfix,
      start,
      maxAttempts,
    );
  } else if (prefix) {
    result = mineSaltForPrefix(
      factory,
      deployerAddress,
      contractName,
      version,
      prefix,
      start,
      maxAttempts,
    );
  } else {
    result = mineSaltForPostfix(
      factory,
      deployerAddress,
      contractName,
      version,
      postfix!,
      start,
      maxAttempts,
    );
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  // Cross-check against on-chain CreateX mock or real factory if available.
  let onChainMatch: string | undefined;
  try {
    onChainMatch = await predictCreate3Address(ethers, factory, deployerAddress, result.salt);
  } catch {
    // ignore; factory may not be deployed on this network
  }

  console.log(`Found in ${formatAttempts(result.attempts)} attempts (${elapsed}s)`);
  console.log(`  Salt:        ${result.salt}`);
  console.log(`  Guarded:     ${result.guardedSalt}`);
  console.log(`  Address:     ${result.address}`);
  if (onChainMatch) {
    console.log(`  On-chain:    ${onChainMatch}`);
    if (onChainMatch.toLowerCase() !== result.address.toLowerCase()) {
      throw new Error("Off-chain address does not match on-chain prediction!");
    }
  }

  console.log("");
  console.log("Important: CreateX takes different salt inputs for deployment vs prediction.");
  console.log("  - Pass the Raw salt to deployCreate3().");
  console.log("  - Pass the Guarded salt to computeCreate3Address(bytes32).");
  console.log(`  cast call ${factory} "computeCreate3Address(bytes32)" ${result.guardedSalt}`);
  console.log("");
  console.log("Use this salt in deploy scripts/tests by passing it to deployViaCreate3():");
  console.log(
    `  canonicalSalt("${deployerAddress}", "${contractName}", "${version}", "${start + result.attempts - 1}")`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
