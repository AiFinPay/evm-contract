/**
 * Deploy a Gnosis Safe multisig wallet for the selected network.
 *
 * The Safe address is made predictable via CREATE2 through the canonical
 * Safe Proxy Factory. The default target prefix is 0x5afe, but can be changed
 * or disabled with --prefix / --no-prefix. The script aborts if the predicted
 * address does not match the address returned by the factory transaction.
 *
 * Configuration is read from config/v14-production-config.ts:
 *   - MULTISIG_SAFE_OWNERS
 *   - MULTISIG_SAFE_THRESHOLD
 *
 * Safe version and factory addresses are read from config/safe-networks.ts by chainId.
 *
 * Usage:
 *   bun run deploy:multisig --network polygon
 *   bun run deploy:multisig --network amoy
 *   bun run deploy:multisig --network polygon --max 100000000
 *   bun run deploy:multisig --network polygon --start 1000000 --max 50000000
 *
 * Optional safety flags:
 *   --prefix HEX     Vanity prefix to mine (default: 5afe; use --no-prefix to skip)
 *   --no-prefix      Skip vanity mining and deploy with salt 0
 *
 * Script arguments are parsed manually because Hardhat does not accept
 * custom global options. This script runs directly with bun and creates its
 * own Hardhat network connection.
 *
 *   --max N          Maximum mining attempts (default 50,000,000)
 *   --start N        Start mining from this salt nonce (default 0)
 *   --safe-version   Safe version override: 1.3.0, 1.4.1, or 1.5.0
 *                    (defaults to the version configured for the chain)
 *
 * The default --max is 50,000,000; with the 0x5afe prefix the expected
 * number of attempts is ~1,048,576, but variance is high.
 *
 * Env files:
 *   - amoy network: .env.testnet
 *   - all other networks: .env.production
 */

import { config as dotenvConfig } from "dotenv";
import { Contract, Interface, TransactionReceipt, ZeroAddress } from "ethers";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Load the correct env file BEFORE importing hardhat, so the network config
// (accounts, RPC, etc.) picks up the values.
dotenvConfig({ path: ".env" });
const networkArgIndex = process.argv.indexOf("--network");
const selectedNetwork = networkArgIndex >= 0 ? process.argv[networkArgIndex + 1] : "polygon";
const envFile = selectedNetwork === "amoy" ? ".env.testnet" : ".env.production";
dotenvConfig({ path: envFile, override: true });
console.log(`Loaded env file: ${envFile}`);

const { network } = await import("hardhat");
import { getDeployerInfo } from "./lib/deployment.js";
import {
  buildSafeInitializer,
  computeSafeInitCodeHash,
  MineResult,
  mineSaltForPrefixCandidates,
  predictSafeAddress,
  SAFE_PROXY_FACTORY_ABI,
} from "./lib/safe-address.js";
import { getSafeConfig, type SafeVersion } from "../config/safe-networks.js";
import { MULTISIG_SAFE_OWNERS, MULTISIG_SAFE_THRESHOLD } from "../config/v14-production-config.js";

const { ethers, networkName } = await network.create(selectedNetwork);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function writeSafeDeploymentRecord(
  _networkName: string,
  _chainId: number,
  _record: Record<string, unknown>,
): string {
  const timestamp = new Date().toISOString();
  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const safeTs = timestamp.replace(/[:.]/g, "-");
  const timestamped = path.join(deploymentsDir, `${_networkName}-safe-multisig-${safeTs}.json`);
  const latest = path.join(deploymentsDir, `${_networkName}-safe-multisig-latest.json`);

  const payload = JSON.stringify(
    {
      network: _networkName,
      chainId: _chainId,
      timestamp,
      ..._record,
    },
    null,
    2,
  );

  fs.writeFileSync(timestamped, payload + "\n");
  fs.writeFileSync(latest, payload + "\n");

  return latest;
}

function parseArg(_name: string): string | undefined {
  const idx = process.argv.indexOf(_name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function parseBigintArg(_name: string): bigint | undefined {
  const value = parseArg(_name);
  return value !== undefined ? BigInt(value) : undefined;
}

/**
 * Find the ProxyCreation event in the factory receipt and return the deployed
 * proxy address. This is more reliable than relying solely on CREATE2 prediction.
 */
function extractProxyAddress(_receipt: TransactionReceipt): string | undefined {
  const eventFragment = "ProxyCreation(address,address)";
  const iface = new Interface([`event ${eventFragment}`]);
  for (const log of _receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed) return parsed.args.proxy as string;
    } catch {
      // ignore non-matching logs
    }
  }
  return undefined;
}

async function main() {
  const maxAttempts = parseBigintArg("--max") ?? 50000000n;
  const start = parseBigintArg("--start") ?? 0n;
  const safeVersionArg = parseArg("--safe-version");
  const safeVersion: SafeVersion | undefined = safeVersionArg
    ? (safeVersionArg as SafeVersion)
    : undefined;
  const noPrefix = process.argv.includes("--no-prefix");
  const prefixArg = parseArg("--prefix");
  const prefix = noPrefix ? undefined : (prefixArg ?? "5afe");

  console.log("Step 1/4: Loading deployer and network info...");
  const { chainId, address: deployerAddress } = await getDeployerInfo(ethers, networkName);

  console.log("\nStep 2/4: Loading Safe multisig configuration...");
  const safeConfig = getSafeConfig(chainId, safeVersion);
  const owners = [...MULTISIG_SAFE_OWNERS];
  const threshold = MULTISIG_SAFE_THRESHOLD;

  console.log(`Network:     ${networkName} (chainId ${chainId})`);
  console.log(`Deployer:    ${deployerAddress}`);
  console.log(`Safe Config: ${safeConfig.chainName} / v${safeConfig.safeVersion}`);
  console.log(`  Prefix:      ${prefix ?? "(disabled)"}`);
  if (prefix && prefix !== "5afe") {
    console.log(`  (overridden via --prefix from default 5afe)`);
  }
  if (safeVersion) {
    console.log(
      `  (overridden via --safe-version from default ${getSafeConfig(chainId).safeVersion})`,
    );
  }
  console.log(`  Proxy Factory: ${safeConfig.proxyFactory}`);
  console.log(`  Singleton:     ${safeConfig.singleton}`);
  console.log(`  Owners:        ${owners.join(", ")}`);
  console.log(`  Threshold:     ${threshold}`);

  if (safeConfig.transactionService) {
    console.log(`  Transaction Service: ${safeConfig.transactionService}`);
  }

  console.log("\nStep 3/4: Reading Safe proxy init code hash from on-chain factory...");
  const factory = new Contract(
    safeConfig.proxyFactory,
    SAFE_PROXY_FACTORY_ABI,
    (await ethers.getSigners())[0],
  );

  // Use the on-chain init code hash when available; fallback to off-chain computation
  // for factories that do not expose proxyCreationCodehash (e.g. very old deployments).
  let initCodeHash: string;
  try {
    initCodeHash = await factory.proxyCreationCodehash(safeConfig.singleton);
  } catch {
    const proxyCreationCode: string = await factory.proxyCreationCode();
    initCodeHash = computeSafeInitCodeHash(proxyCreationCode, safeConfig.singleton);
  }
  console.log(`  Init code hash: ${initCodeHash}`);

  const initializer = buildSafeInitializer(owners, threshold);
  console.log("  Built Safe setup initializer");

  let predictedAddress: string | undefined;
  let saltNonce: bigint | undefined;
  let candidates: MineResult[] = [];

  if (prefix) {
    console.log("\nStep 4/4: Mining salt for prefix 0x" + prefix + " and deploying...");
    console.log(`  Max attempts: ${maxAttempts.toLocaleString()}`);
    const startMine = Date.now();
    candidates = mineSaltForPrefixCandidates(
      initCodeHash,
      safeConfig.proxyFactory,
      initializer,
      prefix,
      start,
      maxAttempts,
      20,
      (attempts) => {
        const elapsed = ((Date.now() - startMine) / 1000).toFixed(1);
        console.log(`    ${attempts.toLocaleString()} attempts checked (${elapsed}s)`);
      },
    );
    console.log(`  Found ${candidates.length} candidate salt(s)`);

    for (const candidate of candidates) {
      const code = await ethers.provider.getCode(candidate.address);
      if (code === "0x") {
        predictedAddress = candidate.address;
        saltNonce = candidate.saltNonce;
        console.log(`  Selected candidate: ${predictedAddress} (salt ${saltNonce})`);
        break;
      }
    }
  } else {
    console.log("\nStep 4/4: Deploying Safe with salt nonce 0 (no vanity prefix)...");
    saltNonce = 0n;
    predictedAddress = predictSafeAddress(
      safeConfig.proxyFactory,
      initCodeHash,
      initializer,
      saltNonce,
    );
    console.log(`  Predicted address: ${predictedAddress}`);
  }

  if (!predictedAddress || saltNonce === undefined) {
    throw new Error(
      `All ${candidates.length} mined candidate addresses already have code on-chain. ` +
        "Increase --max or use a different --start to find an empty address.",
    );
  }

  // Final pre-flight check: the predicted address must be empty. The Safe Proxy
  // Factory reverts on CREATE2 collision, but checking now avoids wasting gas.
  const preflightCode = await ethers.provider.getCode(predictedAddress);
  if (preflightCode !== "0x") {
    throw new Error(
      `Predicted Safe address ${predictedAddress} already has code on-chain. ` +
        "Refusing to deploy (factory would revert on CREATE2 collision).",
    );
  }

  const estimatedGas = await factory.createProxyWithNonce.estimateGas(
    safeConfig.singleton,
    initializer,
    saltNonce,
  );
  const gasLimit = (estimatedGas * 120n) / 100n;
  console.log(`  Estimated gas:            ${estimatedGas.toString()}`);
  console.log(`  Gas limit (with buffer):  ${gasLimit.toString()}`);

  const feeData = await ethers.provider.getFeeData();
  const maxFeePerGas = feeData.maxFeePerGas ? (feeData.maxFeePerGas * 120n) / 100n : undefined;
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas
    ? (feeData.maxPriorityFeePerGas * 120n) / 100n
    : undefined;
  const gasPrice = feeData.gasPrice ? (feeData.gasPrice * 120n) / 100n : undefined;
  console.log(`  maxFeePerGas:             ${maxFeePerGas?.toString() ?? "n/a"}`);
  console.log(`  maxPriorityFeePerGas:     ${maxPriorityFeePerGas?.toString() ?? "n/a"}`);

  const txOverrides: {
    gasLimit: bigint;
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
    gasPrice?: bigint;
  } = {
    gasLimit,
  };
  if (maxFeePerGas !== undefined && maxPriorityFeePerGas !== undefined) {
    txOverrides.maxFeePerGas = maxFeePerGas;
    txOverrides.maxPriorityFeePerGas = maxPriorityFeePerGas;
  } else if (gasPrice !== undefined) {
    txOverrides.gasPrice = gasPrice;
  }

  const tx = await factory.createProxyWithNonce(
    safeConfig.singleton,
    initializer,
    saltNonce,
    txOverrides,
  );
  console.log(`  Deploy tx hash:           ${tx.hash}`);

  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error("Safe Proxy Factory transaction failed or produced no receipt.");
  }

  // Some RPC providers lag behind the chain head even after tx.wait() returns.
  // Retry getCode a few times with a short delay before giving up.
  let deployedCode = "0x";
  for (let attempt = 1; attempt <= 5; attempt++) {
    deployedCode = await ethers.provider.getCode(predictedAddress);
    if (deployedCode !== "0x") break;
    console.log(`  getCode returned 0x (attempt ${attempt}/5), retrying in 3s...`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (deployedCode === "0x") {
    throw new Error(
      `No contract code at predicted address ${predictedAddress}. ` +
        "The Safe was not deployed where expected.",
    );
  }

  // Cross-check: factory-emitted ProxyCreation address must match prediction.
  const emittedProxy = extractProxyAddress(receipt);
  if (emittedProxy) {
    if (emittedProxy.toLowerCase() !== predictedAddress.toLowerCase()) {
      throw new Error(
        `Factory emitted proxy address ${emittedProxy} does not match predicted ${predictedAddress}.`,
      );
    }
    console.log(`  Factory-emitted address:  ${emittedProxy}`);
  } else {
    console.log(
      "  Warning: could not extract ProxyCreation event from receipt; falling back to CREATE2 prediction.",
    );
  }

  console.log(`  Actual Safe address:      ${predictedAddress}`);
  console.log(`  Runtime code length:      ${(deployedCode.length - 2) / 2} bytes`);

  console.log("\n  Writing Safe deployment record...");
  const latest = writeSafeDeploymentRecord(networkName, chainId, {
    safeVersion: safeConfig.safeVersion,
    safeAddress: predictedAddress,
    proxyFactory: safeConfig.proxyFactory,
    singleton: safeConfig.singleton,
    saltNonce: saltNonce.toString(),
    owners,
    threshold,
    initializer,
    deployer: deployerAddress,
    transactionHash: tx.hash,
    transactionService: safeConfig.transactionService,
  });
  console.log(`  Deployment record written to ${latest}`);

  console.log(`\n✅ Safe multisig deployed on ${networkName}: ${predictedAddress}`);
  console.log(`   Transaction: ${tx.hash}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
