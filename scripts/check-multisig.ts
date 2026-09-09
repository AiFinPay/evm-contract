/**
 * Display the on-chain state of the Gnosis Safe multisig deployed for the selected
 * network by reading the local deployment record.
 *
 * Usage:
 *   bun run check:multisig                  # default network: polygon
 *   bun run check:multisig --network amoy
 *
 * The script reads deployments/<network>-safe-multisig-latest.json, connects to
 * the configured Safe singleton, and prints owner list, threshold, nonce, balances,
 * and transaction service links. It does not send transactions.
 */

import { config as dotenvConfig } from "dotenv";
import { Contract, Interface } from "ethers";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";
import { getDeployerInfo } from "./lib/deployment.js";

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
  "function getModulesPaginated(address start, uint256 pageSize) view returns (address[] array, address next)",
  "function isOwner(address owner) view returns (bool)",
];

const RPC_MAX_RETRIES = 5;
const RPC_BASE_DELAY_MS = 500;

/**
 * Execute an async function with exponential backoff retry.
 *
 * Retries on transient RPC errors (network, timeout, rate-limit) and logs each
 * attempt so the operator can see when the configured RPC is flaky.
 */
async function withRetry<T>(_label: string, _fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RPC_MAX_RETRIES; attempt++) {
    try {
      return await _fn();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const isTransient =
        /timeout|rate limit|429|503|502|network|connection reset|econnreset|socket|header/i.test(
          message,
        );
      if (!isTransient) {
        throw error;
      }
      if (attempt === RPC_MAX_RETRIES) {
        break;
      }
      const delay = RPC_BASE_DELAY_MS * 2 ** (attempt - 1);
      console.warn(`  RPC retry (${attempt}/${RPC_MAX_RETRIES}) for ${_label}: ${message}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  const finalMessage = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `RPC call failed after ${RPC_MAX_RETRIES} attempts for ${_label}: ${finalMessage}`,
  );
}

/**
 * Log the provider URL if available (only for http networks).
 */
function logProviderUrl(_ethers: any, _networkName: string): void {
  try {
    const provider = _ethers.provider;
    if (provider && typeof provider.getUrl === "function") {
      const url = provider.getUrl();
      console.log(`  RPC endpoint: ${typeof url === "string" ? url : (url?.url ?? "(unknown)")}`);
    }
  } catch {
    // Provider may not expose its URL; ignore.
  }
}

function readSafeDeploymentRecord(_networkName: string): SafeDeploymentRecord | null {
  const deploymentsDir = path.join(__dirname, "../deployments");
  const recordPath = path.join(deploymentsDir, `${_networkName}-safe-multisig-latest.json`);
  if (!fs.existsSync(recordPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(recordPath, "utf8")) as SafeDeploymentRecord;
}

function explorerLink(_networkName: string, _address: string): string {
  switch (_networkName) {
    case "polygon":
      return `https://polygonscan.com/address/${_address}`;
    case "amoy":
      return `https://amoy.polygonscan.com/address/${_address}`;
    case "avalanche":
      return `https://snowtrace.io/address/${_address}`;
    case "arbitrum":
      return `https://arbiscan.io/address/${_address}`;
    case "bsc":
      return `https://bscscan.com/address/${_address}`;
    case "base":
      return `https://basescan.org/address/${_address}`;
    case "optimism":
      return `https://optimistic.etherscan.io/address/${_address}`;
    default:
      return _address;
  }
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
  console.log(`  Recorded at:   ${record.timestamp}`);
  console.log(`  Deployer:      ${record.deployer}`);
  console.log(`  Deploy tx:     ${record.transactionHash}`);
  console.log(`  Safe version:  ${record.safeVersion}`);
  console.log(`  Proxy factory: ${record.proxyFactory}`);
  console.log(`  Singleton:     ${record.singleton}`);
  console.log(`  Salt nonce:    ${record.saltNonce}`);
  console.log(`  Initializer:   ${record.initializer}`);
  if (record.transactionService) {
    console.log(`  Tx service:    ${record.transactionService}`);
  }

  const { ethers, networkName } = await network.create(selectedNetwork);
  const { chainId } = await getDeployerInfo(ethers, networkName);

  logProviderUrl(ethers, networkName);

  if (chainId !== record.chainId) {
    throw new Error(
      `Chain ID mismatch: deployment record says ${record.chainId}, connected network is ${chainId}.`,
    );
  }

  console.log("\nOn-chain Safe state");
  console.log(`  Safe address:  ${record.safeAddress}`);
  console.log(`  Explorer:      ${explorerLink(selectedNetwork, record.safeAddress)}`);

  const safe = new Contract(record.safeAddress, SAFE_SINGLETON_ABI, ethers.provider);

  let owners: string[] = [];
  let threshold: bigint = 0n;
  let nonce: bigint = 0n;
  let version: string | null = null;

  // Read core state with retries. We read sequentially to avoid hammering a
  // flaky RPC with parallel calls; VERSION() is optional and handled separately.
  try {
    owners = await withRetry("getOwners", () => safe.getOwners());
    threshold = await withRetry("getThreshold", () => safe.getThreshold());
    nonce = await withRetry("nonce", () => safe.nonce());
    version = await withRetry("VERSION", () => safe.VERSION());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/VERSION/.test(message)) {
      // Some Safe v1.4.1 singletons on testnets do not expose VERSION().
      version = null;
    } else {
      throw error;
    }
  }

  console.log(
    `  VERSION():     ${version ?? "(not exposed; record says " + record.safeVersion + ")"}`,
  );
  console.log(`  Owners (${owners.length}):`);
  for (const owner of owners) {
    console.log(`    - ${owner}`);
  }
  console.log(`  Threshold:     ${threshold.toString()}`);
  console.log(`  Nonce:         ${nonce.toString()}`);

  const balance = await withRetry("getBalance", () =>
    ethers.provider.getBalance(record.safeAddress),
  );
  console.log(`  Native balance: ${ethers.formatEther(balance)} ETH/MATIC`);

  const code = await withRetry("getCode", () => ethers.provider.getCode(record.safeAddress));
  console.log(`  Runtime code:  ${code.length > 2 ? (code.length - 2) / 2 : 0} bytes`);

  // Decode the initializer to cross-check against the record.
  const setupIface = new Interface([
    "function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address payable paymentReceiver)",
  ]);
  const decoded = await withRetry("decode initializer", async () =>
    setupIface.parseTransaction({ data: record.initializer }),
  );
  console.log("\nDecoded initializer");
  if (decoded) {
    console.log(`  Function:      ${decoded.name}`);
    console.log(`  _owners:       ${decoded.args._owners.join(", ")}`);
    console.log(`  _threshold:    ${decoded.args._threshold.toString()}`);
    console.log(`  to:            ${decoded.args.to}`);
    console.log(`  fallbackHandler: ${decoded.args.fallbackHandler}`);
    console.log(`  paymentToken:  ${decoded.args.paymentToken}`);
    console.log(`  payment:       ${decoded.args.payment.toString()}`);
    console.log(`  paymentReceiver: ${decoded.args.paymentReceiver}`);
  } else {
    console.log("  (could not decode initializer)");
  }

  // Consistency checks.
  const recordedOwnersLower = record.owners.map((o) => o.toLowerCase());
  const onChainOwnersLower = owners.map((o: string) => o.toLowerCase());
  const ownersMatch =
    recordedOwnersLower.length === onChainOwnersLower.length &&
    recordedOwnersLower.every((o) => onChainOwnersLower.includes(o));
  const thresholdMatch = BigInt(record.threshold) === threshold;

  console.log("\nConsistency checks");
  console.log(`  Owners match record:   ${ownersMatch ? "✅ yes" : "❌ no"}`);
  console.log(`  Threshold match record: ${thresholdMatch ? "✅ yes" : "❌ no"}`);
  console.log(`  Has on-chain code:      ${code !== "0x" ? "✅ yes" : "❌ no"}`);

  if (!ownersMatch || !thresholdMatch || code === "0x") {
    throw new Error(
      "On-chain Safe state does not match the local deployment record. Investigate before using this Safe.",
    );
  }

  console.log("\n✅ Multisig deployment record matches on-chain state.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
