/**
 * Initialize (or verify) a Gnosis Safe multisig that was deployed without a
 * proper setup() initializer.
 *
 * Usage:
 *   bun run init:multisig                  # default network: polygon
 *   bun run init:multisig --network amoy
 *
 * The script reads deployments/<network>-safe-multisig-latest.json, checks the
 * on-chain Safe state, and calls setup() if the Safe has not been initialized
 * yet. It uses the owners and threshold recorded in the deployment record.
 *
 * Requires the deployer key to be the sender. Safe setup() can only be called once
 * and only while the proxy is uninitialized.
 */

import { config as dotenvConfig } from "dotenv";
import { Contract, Interface, ZeroAddress } from "ethers";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";
import { getDeployerInfo } from "./lib/deployment.js";
import { buildSafeInitializer } from "./lib/safe-address.js";

// Load env files with the same precedence as deploy-safe-multisig.ts.
dotenvConfig({ path: ".env" });
const networkArgIndex = process.argv.indexOf("--network");
const selectedNetwork = networkArgIndex >= 0 ? process.argv[networkArgIndex + 1] : "polygon";
const envFile = selectedNetwork === "amoy" ? ".env.testnet" : ".env.production";
dotenvConfig({ path: envFile, override: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface SafeDeploymentRecord {
  network: string;
  chainId: number;
  timestamp: string;
  safeVersion: string;
  safeAddress: string;
  proxyFactory: string;
  singleton: string;
  saltNonce: string;
  owners: string[];
  threshold: number;
  initializer: string;
  deployer: string;
  transactionHash: string;
  transactionService?: string;
}

const SAFE_SINGLETON_ABI = [
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function VERSION() view returns (string)",
  "function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address payable paymentReceiver) external",
];

function readSafeDeploymentRecord(_networkName: string): SafeDeploymentRecord | null {
  const deploymentsDir = path.join(__dirname, "../deployments");
  const recordPath = path.join(deploymentsDir, `${_networkName}-safe-multisig-latest.json`);
  if (!fs.existsSync(recordPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(recordPath, "utf8")) as SafeDeploymentRecord;
}

async function main() {
  console.log(`Network: ${selectedNetwork}`);
  console.log(`Loaded env file: ${envFile}\n`);

  const record = readSafeDeploymentRecord(selectedNetwork);
  if (!record) {
    throw new Error(
      `No Safe multisig deployment record found for network "${selectedNetwork}". ` +
        `Run "bun run deploy:multisig --network ${selectedNetwork}" first.`,
    );
  }

  console.log("Local deployment record");
  console.log(`  Record file:   deployments/${selectedNetwork}-safe-multisig-latest.json`);
  console.log(`  Safe address:  ${record.safeAddress}`);
  console.log(`  Owners:        ${record.owners.join(", ")}`);
  console.log(`  Threshold:     ${record.threshold}\n`);

  const { ethers, networkName } = await network.create(selectedNetwork);
  const { chainId, address: deployerAddress } = await getDeployerInfo(ethers, networkName);

  if (chainId !== record.chainId) {
    throw new Error(
      `Chain ID mismatch: deployment record says ${record.chainId}, connected network is ${chainId}.`,
    );
  }

  const signers = await ethers.getSigners();
  if (!signers.length) {
    throw new Error("No signer available. Set a deployer key for this network.");
  }
  const signer = signers[0];
  const signerAddress = await signer.getAddress();
  console.log(`Using signer:    ${signerAddress}`);
  if (signerAddress.toLowerCase() !== record.deployer.toLowerCase()) {
    console.warn(
      `Warning: signer ${signerAddress} does not match recorded deployer ${record.deployer}. ` +
        "setup() can be called by anyone while the Safe is uninitialized, but double-check.",
    );
  }

  const safe = new Contract(record.safeAddress, SAFE_SINGLETON_ABI, ethers.provider);

  let owners: string[] = [];
  let isInitialized = false;
  try {
    owners = await safe.getOwners();
    isInitialized = owners.length > 0;
  } catch {
    // getOwners() reverts when the Safe has not been initialized (empty owner list).
    isInitialized = false;
  }

  if (isInitialized) {
    const threshold = await safe.getThreshold();
    console.log("\n✅ Safe is already initialized.");
    console.log(`  Owners (${owners.length}):`);
    for (const owner of owners) {
      console.log(`    - ${owner}`);
    }
    console.log(`  Threshold:     ${threshold.toString()}`);

    // Cross-check against the record.
    const recordedOwnersLower = record.owners.map((o) => o.toLowerCase());
    const onChainOwnersLower = owners.map((o: string) => o.toLowerCase());
    const ownersMatch =
      recordedOwnersLower.length === onChainOwnersLower.length &&
      recordedOwnersLower.every((o) => onChainOwnersLower.includes(o));
    const thresholdMatch = BigInt(record.threshold) === threshold;
    if (!ownersMatch || !thresholdMatch) {
      throw new Error("On-chain Safe state does not match the local deployment record.");
    }
    console.log("\n✅ On-chain state matches the deployment record.");
    return;
  }

  console.log(
    "\n⚠️  Safe is not initialized. Calling setup() with recorded owners and threshold...",
  );

  // Use the deployer's signer for the setup transaction.
  const safeWithSigner = safe.connect(signer);
  const tx = await safeWithSigner.setup(
    record.owners,
    record.threshold,
    ZeroAddress,
    "0x",
    ZeroAddress,
    ZeroAddress,
    0,
    ZeroAddress,
  );
  console.log(`  Setup tx hash: ${tx.hash}`);

  const receipt = await tx.wait();
  if (!receipt) {
    throw new Error("setup() transaction did not produce a receipt.");
  }
  console.log(`  Confirmed in block: ${receipt.blockNumber}`);

  // Verify initialization.
  const onChainOwners = await safe.getOwners();
  const onChainThreshold = await safe.getThreshold();
  if (onChainOwners.length === 0) {
    throw new Error("setup() succeeded but Safe still has no owners.");
  }

  console.log("\n✅ Safe initialized successfully.");
  console.log(`  Owners (${onChainOwners.length}):`);
  for (const owner of onChainOwners) {
    console.log(`    - ${owner}`);
  }
  console.log(`  Threshold:     ${onChainThreshold.toString()}`);

  // Update the deployment record with the corrected initializer.
  const correctedInitializer = buildSafeInitializer(record.owners, record.threshold);
  if (correctedInitializer !== record.initializer) {
    record.initializer = correctedInitializer;
    const deploymentsDir = path.join(__dirname, "../deployments");
    const recordPath = path.join(deploymentsDir, `${selectedNetwork}-safe-multisig-latest.json`);
    fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + "\n");
    console.log(`\n📝 Updated deployment record initializer to ${correctedInitializer}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
