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
 * Run: DEV_DEPLOYER_KEY=... npx hardhat run scripts/deploy-safe-amoy.ts --network amoy
 */
import { network } from "hardhat";

const { ethers } = await network.create();

const FACTORY = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67";
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

async function main() {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (chainId !== 80002) throw new Error(`Amoy only (80002); got ${chainId}`);

  const owner1 = ethers.getAddress(process.env.SAFE_OWNER_1 ?? "");
  const owner2 = ethers.getAddress(process.env.SAFE_OWNER_2 ?? "");
  if (owner1 === owner2) throw new Error("owners must be distinct");

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} POL`);

  // Prefer the L2 singleton (event-emitting variant used on Polygon chains);
  // fall back to the L1 singleton if L2 has no code on this network.
  const l2Code = await ethers.provider.getCode(SINGLETON_L2);
  const singleton = l2Code !== "0x" ? SINGLETON_L2 : SINGLETON_L1;
  console.log(`Singleton: ${singleton} (${l2Code !== "0x" ? "SafeL2" : "Safe"})`);

  const safeIface = new ethers.Interface(SAFE_ABI);
  const initializer = safeIface.encodeFunctionData("setup", [
    [owner1, owner2], // owners
    2,                // threshold 2-of-2
    ethers.ZeroAddress, "0x", // no delegate call
    ethers.ZeroAddress,       // no fallback handler needed for plain ownership
    ethers.ZeroAddress, 0, ethers.ZeroAddress, // no payment
  ]);

  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, deployer);
  const saltNonce = BigInt(process.env.SAFE_SALT_NONCE ?? "20260818");
  const tx = await factory.createProxyWithNonce(singleton, initializer, saltNonce);
  console.log(`createProxyWithNonce tx: ${tx.hash}`);
  const receipt = await tx.wait();

  const creation = receipt!.logs
    .map((l: any) => { try { return factory.interface.parseLog(l); } catch { return null; } })
    .find((p: any) => p?.name === "ProxyCreation");
  if (!creation) throw new Error("ProxyCreation event not found");
  const safeAddr = creation.args.proxy as string;

  const safe = new ethers.Contract(safeAddr, SAFE_ABI, ethers.provider);
  const owners = await safe.getOwners();
  const threshold = await safe.getThreshold();
  const code = await ethers.provider.getCode(safeAddr);

  console.log(`\n=== AMOY TEST SAFE DEPLOYED ===`);
  console.log(`Safe address: ${safeAddr}`);
  console.log(`Owners:       ${owners.join(", ")}`);
  console.log(`Threshold:    ${threshold}`);
  console.log(`Has code:     ${code !== "0x"} (${(code.length - 2) / 2} bytes)`);
  console.log(`Tx hash:      ${tx.hash}`);
  console.log(`Block:        ${receipt!.blockNumber}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
