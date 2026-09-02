/**
 * TESTNET ONLY — deploy a 2-of-2 Gnosis Safe on Polygon Amoy (chainId 80002).
 *
 * Why this exists: the v1.3 deploy scripts refuse any owner that is not a
 * contract (the "no EOA owner" security gate). Rather than weakening that
 * gate for testnet, we satisfy it honestly by deploying a real Safe with
 * throwaway test owners — which also makes the Amoy run a full dress
 * rehearsal of the mainnet procedure (create Safe → deploy splitters owned
 * by it → verify on-chain).
 *
 * Uses the canonical Safe v1.4.1 contracts, verified present on Amoy:
 *   SafeProxyFactory  0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67
 *   SafeL2 singleton  0x29fcB43b46531BcA003ddC8FCB67FFE91900C762 (L2)
 *   Safe singleton    0x41675C099F32341bf84BFc5382aF534df5C7461a
 *
 * Env: SAFE_OWNER_1, SAFE_OWNER_2 (addresses). Threshold fixed at 2 to match
 * the production preflight's "threshold >= 2, >= 2 unique owners" check.
 *
 * Run: DEV_DEPLOYER_KEY=... bun run hardhat run scripts/deploy-safe-amoy.ts --network amoy
 */
import { network } from "hardhat";
import { ContractTransactionReceipt, Log, TransactionReceipt } from "ethers";
import { getDeployerInfo, writeDeploymentRecord } from "./lib/deployment.js";

const { ethers, networkName } = await network.create();

const FACTORY = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67"; // trusted
const SINGLETON_L2 = "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762";
const SINGLETON_L1 = "0x41675C099F32341bf84BFc5382aF534df5C7461a";

const FACTORY_ABI = [
  "function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
  "event ProxyCreation(address indexed proxy, address singleton)",
];
const SAFE_ABI = [
  "function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
];

function requireAddress(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return ethers.getAddress(value);
}

function parseProxyCreation(receipt: ContractTransactionReceipt | null, factory: any): string {
  if (!receipt) throw new Error("Transaction receipt is null");

  const creation = receipt.logs
    .map((l: Log) => {
      try {
        return factory.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((p: ReturnType<typeof factory.interface.parseLog> | null) => p?.name === "ProxyCreation");

  if (!creation) throw new Error("ProxyCreation event not found");
  const safeAddr = creation.args.proxy as string;
  if (!safeAddr) throw new Error("ProxyCreation event missing proxy address");
  return safeAddr;
}

async function main() {
  console.log("Step 1/5: Loading deployer and network info...");
  const { chainId, address: deployerAddress } = await getDeployerInfo(ethers, networkName);
  if (chainId !== 80002) throw new Error(`Amoy only (80002); got ${chainId}`);

  console.log("\nStep 2/5: Validating Safe owner env vars...");
  const owner1 = requireAddress("SAFE_OWNER_1");
  const owner2 = requireAddress("SAFE_OWNER_2");
  if (owner1 === owner2)
    throw new Error("SAFE_OWNER_1 and SAFE_OWNER_2 must be distinct addresses");
  console.log(`  Owner 1 = ${owner1}`);
  console.log(`  Owner 2 = ${owner2}`);

  console.log("\nStep 3/5: Selecting Safe singleton...");
  const l2Code = await ethers.provider.getCode(SINGLETON_L2);
  const singleton = l2Code !== "0x" ? SINGLETON_L2 : SINGLETON_L1;
  console.log(`  Singleton = ${singleton} (${l2Code !== "0x" ? "SafeL2" : "Safe"})`);
  if ((await ethers.provider.getCode(singleton)) === "0x") {
    throw new Error(`Selected singleton ${singleton} has no code on Amoy`);
  }

  console.log("\nStep 4/5: Building Safe initializer and deploying proxy...");
  const safeIface = new ethers.Interface(SAFE_ABI);
  const initializer = safeIface.encodeFunctionData("setup", [
    [owner1, owner2], // owners
    2, // threshold 2-of-2
    ethers.ZeroAddress,
    "0x", // no delegate call
    ethers.ZeroAddress, // no fallback handler needed for plain ownership
    ethers.ZeroAddress,
    0,
    ethers.ZeroAddress, // no payment
  ]);

  const saltNonce = BigInt(process.env.SAFE_SALT_NONCE ?? "20260818");
  console.log(`  Salt nonce = ${saltNonce}`);

  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, (await ethers.getSigners())[0]);
  const tx = await factory.createProxyWithNonce(singleton, initializer, saltNonce);
  console.log(`  createProxyWithNonce tx = ${tx.hash}`);
  const receipt = await tx.wait();

  const safeAddr = parseProxyCreation(receipt, factory);

  console.log("\nStep 5/5: Verifying deployed Safe and writing record...");
  const safe = new ethers.Contract(safeAddr, SAFE_ABI, ethers.provider);
  const owners = await safe.getOwners();
  const threshold = await safe.getThreshold();
  const code = await ethers.provider.getCode(safeAddr);

  const record = {
    network: networkName,
    chainId,
    safe: {
      address: safeAddr,
      owners,
      threshold: Number(threshold),
      singleton,
      factory: FACTORY,
      saltNonce: saltNonce.toString(),
      deployer: deployerAddress,
      txHash: tx.hash,
      blockNumber: receipt ? Number(receipt.blockNumber) : null,
    },
  };

  const { latest } = writeDeploymentRecord(networkName, chainId, record, `amoy-safe-latest`);
  console.log(`  Deployment record written to ${latest}`);

  console.log(`\n=== AMOY TEST SAFE DEPLOYED ===`);
  console.log(`Safe address: ${safeAddr}`);
  console.log(`Owners:       ${owners.join(", ")}`);
  console.log(`Threshold:    ${threshold}`);
  console.log(`Has code:     ${code !== "0x"} (${(code.length - 2) / 2} bytes)`);
  console.log(`Tx hash:      ${tx.hash}`);
  console.log(`Block:        ${receipt ? receipt.blockNumber : "unknown"}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
