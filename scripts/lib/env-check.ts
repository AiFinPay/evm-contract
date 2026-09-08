// Environment variable and wallet resolution diagnostics.
//
// Mirrors the priority used by hardhat.config.ts so deploy scripts can report
// which wallet is going to sign before any transaction is sent.

import { Wallet, isAddress } from "ethers";
import * as fs from "node:fs";
import * as path from "node:path";

/** Where a deployer/account value is sourced from. */
export type WalletSource = "ledger" | "keystore" | "env" | "none";

export interface ResolvedWallet {
  /** Origin of the signer. */
  source: WalletSource;
  /** Human-readable label for the source. */
  label: string;
  /** Ethereum address (if it could be derived). */
  address?: string;
  /** Name of the environment/keystore key consulted (if any). */
  key?: string;
}

const MAINNET_NETWORKS = [
  "polygon",
  "avalanche",
  "arbitrum",
  "bnb",
  "base",
  "unichain",
  "optimism",
  "botchain",
  "xrplevm",
];

/**
 * Decide whether a network is the Amoy testnet.
 */
export function isTestnet(networkName: string): boolean {
  return networkName.toLowerCase() === "amoy";
}

/**
 * Decide whether a network is a production/mainnet network configured in this repo.
 */
export function isMainnet(networkName: string): boolean {
  return MAINNET_NETWORKS.includes(networkName.toLowerCase());
}

/**
 * Resolve the wallet that will be used for a given network according to the
 * priority in hardhat.config.ts and .env.example:
 *
 *   1. Ledger hardware wallet (LEDGER_ACCOUNT)
 *   2. Hardhat Keystore (PROD_DEPLOYER_KEY, then <NETWORK>_DEPLOYER_KEY)
 *   3. Environment variables (PROD_DEPLOYER_KEY or *_DEPLOYER_KEY)
 *
 * Keystore lookup is intentionally **non-invasive**: we only read the public
 * key list file to determine whether a key is *stored*, without decrypting the
 * keystore.
 */
export async function resolveWallet(networkName: string): Promise<ResolvedWallet> {
  const name = networkName.toLowerCase();
  const ledgerAccount = process.env.LEDGER_ACCOUNT?.trim();

  if (ledgerAccount && isAddress(ledgerAccount)) {
    return {
      source: "ledger",
      label: "Ledger hardware wallet (LEDGER_ACCOUNT)",
      address: ledgerAccount,
      key: "LEDGER_ACCOUNT",
    };
  }

  // Keystore is checked second, before plain env private keys.
  // On mainnet, hardhat.config.ts asks for PROD_DEPLOYER_KEY first and falls
  // back to the network-specific config variable.
  const keystoreKeys = isMainnet(name)
    ? ["PROD_DEPLOYER_KEY", `${name.toUpperCase()}_DEPLOYER_KEY`]
    : isTestnet(name)
      ? ["DEV_DEPLOYER_KEY"]
      : [`${name.toUpperCase()}_DEPLOYER_KEY`];

  for (const keystoreKey of keystoreKeys) {
    if (hasKeystoreKey(keystoreKey)) {
      return {
        source: "keystore",
        label: "Hardhat Keystore",
        address: undefined, // cannot derive address without decrypting
        key: keystoreKey,
      };
    }
  }

  // Plain environment variable fallback.
  const envKey = isMainnet(name) ? "PROD_DEPLOYER_KEY" : "DEV_DEPLOYER_KEY";
  const rawKey = process.env[envKey]?.trim();
  if (rawKey) {
    try {
      const address = new Wallet(rawKey).address;
      return {
        source: "env",
        label: "Environment variable",
        address,
        key: envKey,
      };
    } catch {
      return {
        source: "env",
        label: "Environment variable (invalid private key)",
        address: undefined,
        key: envKey,
      };
    }
  }

  // No usable wallet found.
  return {
    source: "none",
    label: "No wallet configured",
    key: envKey,
  };
}

/**
 * Check whether a key appears in the Hardhat Keystore *without* unlocking it.
 *
 * Keystore files are stored in ~/.local/share/hardhat-nodejs/keystore by default
 * (or the path pointed to by HH_KEYSTORE_PATH). The public key list
 * (keystore.json) contains key names in plaintext, so we can detect presence
 * without prompting for a password.
 */
function hasKeystoreKey(key: string): boolean {
  // Keystore is only relevant for actual secret values. If the same name is set
  // in process.env, the Hardhat resolver uses env first, so return false to let
  // env resolution win.
  if (process.env[key] !== undefined) {
    return false;
  }

  const customPath = process.env.HH_KEYSTORE_PATH;
  const os = process.platform;

  let keystoreDir: string;
  if (customPath) {
    keystoreDir = customPath;
  } else if (os === "win32") {
    const appData = process.env.LOCALAPPDATA;
    if (!appData) return false;
    keystoreDir = path.join(appData, "hardhat-nodejs", "keystore");
  } else {
    const home = process.env.HOME;
    if (!home) return false;
    const xdgData = process.env.XDG_DATA_HOME;
    keystoreDir = xdgData
      ? path.join(xdgData, "hardhat-nodejs", "keystore")
      : path.join(home, ".local", "share", "hardhat-nodejs", "keystore");
  }

  try {
    const listPath = path.join(keystoreDir, "keystore.json");
    if (!fs.existsSync(listPath)) return false;
    const list = JSON.parse(fs.readFileSync(listPath, "utf8")) as { keys?: string[] };
    return Array.isArray(list.keys) && list.keys.includes(key);
  } catch {
    return false;
  }
}
