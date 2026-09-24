/**
 * Resolve and display the wallet that Hardhat would use for the selected network.
 *
 * Usage:
 *   bun run check:wallet                  # default network: polygon
 *   bun run check:wallet --network amoy
 *   bun run check:wallet --network base
 *
 * Does not unlock the Hardhat Keystore, does not connect to a network, and does
 * not send transactions.
 */

import * as dotenv from "dotenv";
import { Wallet } from "ethers";
import { isTestnet, resolveWallet } from "./lib/env-check.js";

// Load env files with the same precedence as deploy-splitter-v14.ts.
dotenv.config({ path: ".env" });
const networkArgIndex = process.argv.indexOf("--network");
const networkName = networkArgIndex >= 0 ? process.argv[networkArgIndex + 1] : "polygon";
const envFile = isTestnet(networkName) ? ".env.testnet" : ".env.production";
dotenv.config({ path: envFile, override: true });

console.log(`Network: ${networkName}`);
console.log(`Loaded env file: ${envFile}`);
console.log();

function maskAddress(address: string): string {
  if (address.length <= 10) return "(redacted)";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

const wallet = await resolveWallet(networkName);

console.log("Resolved wallet:");
console.log(`  Source : ${wallet.source}`);
console.log(`  Label  : ${wallet.label}`);
console.log(`  Key    : ${wallet.key ?? ""}`);

if (wallet.address) {
  console.log(`  Address: ${maskAddress(wallet.address)}`);
} else if (wallet.source === "keystore") {
  console.log("  Address: (not derivable without decrypting the keystore)");
} else if (wallet.source === "env" && wallet.key) {
  // For env keys, derive the address if possible.
  const raw = process.env[wallet.key]?.trim();
  if (raw) {
    try {
      console.log(`  Address: ${maskAddress(new Wallet(raw).address)}`);
    } catch {
      console.log("  Address: (invalid private key)");
    }
  }
}

if (wallet.source === "none") {
  console.error("\n❌ No wallet configured for this network.");
  process.exitCode = 1;
} else {
  console.log("\n✅ A wallet is configured for this network.");
}
