/**
 * Print the current environment configuration and the wallet that would be used
 * for a selected network.
 *
 * Usage:
 *   bun run check:env                  # default network: polygon
 *   bun run check:env --network amoy
 *   bun run check:env --network base
 *
 * This script never decrypts the Hardhat Keystore and never sends transactions.
 */

import * as dotenv from "dotenv";
import { isAddress } from "ethers";
import {
  chainIdForNetwork,
  isMainnet,
  isTestnet,
  resolveWallet,
  type ResolvedWallet,
} from "./lib/env-check.js";

// Load .env first, then the network-specific env file (same precedence as
// deploy-splitter-v14.ts).
dotenv.config({ path: ".env" });
const networkArgIndex = process.argv.indexOf("--network");
const networkName = networkArgIndex >= 0 ? process.argv[networkArgIndex + 1] : "polygon";
const envFile = isTestnet(networkName) ? ".env.testnet" : ".env.production";
dotenv.config({ path: envFile, override: true });

function env(name: string): string | undefined {
  return process.env[name]?.trim();
}

function status(name: string, value?: string, redact = false): string {
  const label = name.padEnd(26, " ");
  if (!value) {
    return `${label}: ${"not set".padEnd(42, " ")} ❌`;
  }
  const display = redact ? "***" : value;
  return `${label}: ${display.padEnd(42, " ")} ✅`;
}

function renderWallet(wallet: ResolvedWallet): string {
  const source = wallet.source.padEnd(10, " ");
  const address = wallet.address ?? "(address not derivable without decryption)";
  return `${source} | ${wallet.label} | ${wallet.key ?? ""} | ${address}`;
}

console.log("=".repeat(80));
console.log("AiFinPay deploy environment check");
console.log("=".repeat(80));
console.log(
  `Network: ${networkName} (${isTestnet(networkName) ? "testnet" : isMainnet(networkName) ? "mainnet" : "unknown"})`,
);
console.log(`Loaded env file: ${envFile}`);
console.log();

console.log("--- General env variables ---");
console.log(status("FEE_PROFILE", env("FEE_PROFILE")));
console.log(status("ETHERSCAN_API_KEY", env("ETHERSCAN_API_KEY"), true));
console.log(status("POLYGONSCAN_API_KEY", env("POLYGONSCAN_API_KEY"), true));
console.log();

console.log("--- Wallet priority (1. Ledger  2. Keystore  3. Env) ---");
console.log(status("LEDGER_ACCOUNT", env("LEDGER_ACCOUNT")));
console.log(status("PROD_DEPLOYER_KEY", env("PROD_DEPLOYER_KEY"), true));
if (networkName.toLowerCase() !== "polygon") {
  console.log(
    status(
      `${networkName.toUpperCase()}_DEPLOYER_KEY`,
      env(`${networkName.toUpperCase()}_DEPLOYER_KEY`),
      true,
    ),
  );
}
console.log(status("DEV_DEPLOYER_KEY", env("DEV_DEPLOYER_KEY"), true));
console.log();

console.log("--- v1.4 governance env variables ---");
const chainId =
  isMainnet(networkName) || isTestnet(networkName) ? chainIdForNetwork(networkName) : "???";
const safeKey = `AIFINPAY_SAFE_${chainId}`;
const treasuryKey = `AIFINPAY_TREASURY_${chainId}`;
const pauserKey = `AIFINPAY_PAUSER_${chainId}`;
console.log(status(safeKey, env(safeKey)));
console.log(status(treasuryKey, env(treasuryKey)));
console.log(status(pauserKey, env(pauserKey)));
console.log(status("AIFINPAY_V14_SIGNER", env("AIFINPAY_V14_SIGNER")));
console.log();

console.log("--- RPC endpoints ---");
const rpcKey = isTestnet(networkName)
  ? "AMOY_RPC"
  : networkName.toLowerCase() === "botchain"
    ? "BOTCHAIN_RPC"
    : networkName.toLowerCase() === "xrplevm"
      ? "XRPLEVM_RPC"
      : networkName.toLowerCase() === "optimism"
        ? "OPTIMISM_RPC"
        : networkName.toLowerCase() === "unichain"
          ? "UNICHAIN_RPC"
          : `${networkName.toUpperCase()}_MAINNET_RPC`;
const fallback = isTestnet(networkName)
  ? "https://rpc-amoy.polygon.technology"
  : isMainnet(networkName)
    ? "configured in hardhat.config.ts"
    : "none";
console.log(
  `${rpcKey.padEnd(26, " ")}: ${(env(rpcKey) ?? fallback).padEnd(42, " ")} ${env(rpcKey) ? "✅" : "ℹ️ "}`,
);
console.log();

console.log("--- Resolved wallet for this network ---");
const wallet = await resolveWallet(networkName);
console.log(renderWallet(wallet));
console.log();

const errors: string[] = [];
if (wallet.source === "none") {
  errors.push("No deployer wallet is configured for this network.");
}
if (wallet.address !== undefined && !isAddress(wallet.address)) {
  errors.push(`Resolved wallet address is not a valid checksummed address: ${wallet.address}`);
}

if (errors.length) {
  console.log("⚠️  Issues found:");
  for (const err of errors) {
    console.log(`  - ${err}`);
  }
  process.exitCode = 1;
} else {
  console.log("✅ Environment looks good for this network.");
}
