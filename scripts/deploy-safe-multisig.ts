/**
 * Deploy a Gnosis Safe multisig wallet for the selected network.
 *
 * The Safe address is made predictable (and vanity-mined to start with 0x5afe)
 * via CREATE2 through the canonical Safe Proxy Factory.
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
import { Contract, ZeroAddress } from "ethers";
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
  mineSaltForPrefixCandidates,
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

async function main() {
  const maxAttempts = BigInt(parseArg("--max") || "50000000");
  const start = BigInt(parseArg("--start") || "0");
  const safeVersionArg = parseArg("--safe-version");
  const safeVersion: SafeVersion | undefined = safeVersionArg
    ? (safeVersionArg as SafeVersion)
    : undefined;

  console.log("Step 1/4: Loading deployer and network info...");
  const { chainId, address: deployerAddress } = await getDeployerInfo(ethers, networkName);

  console.log("\nStep 2/4: Loading Safe multisig configuration...");
  const safeConfig = getSafeConfig(chainId, safeVersion);
  const owners = [...MULTISIG_SAFE_OWNERS];
  const threshold = MULTISIG_SAFE_THRESHOLD;

  console.log(`Network:     ${networkName} (chainId ${chainId})`);
  console.log(`Deployer:    ${deployerAddress}`);
  console.log(`Safe Config: ${safeConfig.chainName} / v${safeConfig.safeVersion}`);
  if (safeVersion) {
    console.log(`  (overridden via --safe-version from default ${getSafeConfig(chainId).safeVersion})`);
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

  console.log("\nStep 4/4: Mining salt for prefix 0x5afe and deploying...");
  console.log(`  Max attempts: ${maxAttempts.toLocaleString()}`);
  const startMine = Date.now();
  const candidates = mineSaltForPrefixCandidates(
    initCodeHash,
    safeConfig.proxyFactory,
    initializer,
    "5afe",
    start,
    maxAttempts,
    20,
    (attempts) => {
      const elapsed = ((Date.now() - startMine) / 1000).toFixed(1);
      console.log(`    ${attempts.toLocaleString()} attempts checked (${elapsed}s)`);
    },
  );
  console.log(`  Found ${candidates.length} candidate salt(s)`);

  let predictedAddress: string | undefined;
  let saltNonce: bigint | undefined;
  for (const candidate of candidates) {
    const code = await ethers.provider.getCode(candidate.address);
    if (code === "0x") {
      predictedAddress = candidate.address;
      saltNonce = candidate.saltNonce;
      console.log(`  Selected candidate: ${predictedAddress} (salt ${saltNonce})`);
      break;
    }
  }

  if (!predictedAddress || saltNonce === undefined) {
    throw new Error(
      `All ${candidates.length} mined candidate addresses already have code on-chain. ` +
        "Increase --max or use a different --start to find an empty address.",
    );
  }

  const tx = await factory.createProxyWithNonce(safeConfig.singleton, initializer, saltNonce);
  console.log(`  Deploy tx hash:           ${tx.hash}`);

  await tx.wait();

  const deployedCode = await ethers.provider.getCode(predictedAddress);
  if (deployedCode === "0x") {
    throw new Error(
      `No contract code at predicted address ${predictedAddress}. ` +
        "The Safe was not deployed where expected.",
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
