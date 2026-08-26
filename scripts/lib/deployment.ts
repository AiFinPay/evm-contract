// Shared deployment helpers for Hardhat scripts.
//
// This module extracts duplicated boilerplate from deploy.ts and the splitter
// deploy scripts: network introspection, deployer balance logging, deployment
// directory creation, and record writing. Keeping it in one place means a fix
// to record formatting or error handling applies everywhere.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { NetworkConnection } from "hardhat/dist/src/types/network";
import type { DeploymentRecord } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type NetworkContext = NetworkConnection<"generic">;

export interface DeployerInfo {
  address: string;
  balance: bigint;
  chainId: number;
}

/**
 * Return the first signer, native balance, and numeric chainId, plus log the
 * standard deployer header every deployment script prints.
 */
export async function getDeployerInfo(
  ethers: NetworkContext["ethers"],
  networkName: string
): Promise<DeployerInfo> {
  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log(`Network:  ${networkName} (chainId ${chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(balance)} native`);

  return { address: deployer.address, balance, chainId };
}

/**
 * Ensure `deployments/` exists and write a deployment record.
 *
 * Writes two files:
 *   deployments/<network>-<iso-timestamp>.json
 *   deployments/<network>-latest.json      (or custom suffix)
 *
 * Returns the path of the timestamped record.
 */
export function writeDeploymentRecord(
  networkName: string,
  chainId: number,
  record: Omit<DeploymentRecord, "network" | "chainId" | "timestamp">,
  suffix: string = "latest"
): { timestamped: string; latest: string } {
  const timestamp = new Date().toISOString();
  const deploymentsDir = path.join(__dirname, "../../deployments");

  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deploymentRecord: DeploymentRecord = {
    network: networkName,
    chainId,
    timestamp,
    ...record,
  };

  const payload = JSON.stringify(deploymentRecord, null, 2) + "\n";
  const safeTs = timestamp.replace(/[:.]/g, "-");
  const timestamped = path.join(deploymentsDir, `${networkName}-${safeTs}.json`);
  const latest = path.join(deploymentsDir, `${networkName}-${suffix}.json`);

  fs.writeFileSync(timestamped, payload);
  fs.writeFileSync(latest, payload);

  return { timestamped, latest };
}

/**
 * Read the latest deployment record for a network, if it exists.
 */
export function readLatestDeploymentRecord(networkName: string): DeploymentRecord | null {
  const deploymentsDir = path.join(__dirname, "../../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    return null;
  }

  const latestRecordPath = path.join(deploymentsDir, `${networkName}-latest.json`);
  if (!fs.existsSync(latestRecordPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(latestRecordPath, "utf8")) as DeploymentRecord;
}

/**
 * Compute the keccak256 runtime code hash for a deployed address.
 */
export async function computeRuntimeCodeHash(
  ethers: NetworkContext["ethers"],
  address: string
): Promise<string> {
  const runtimeCode = await ethers.provider.getCode(address);
  return ethers.keccak256(runtimeCode);
}
