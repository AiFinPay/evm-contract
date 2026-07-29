import { ethers, network } from "hardhat";

// Deploys ONLY B2BSplitter v1.2 (AIFINP-34/35/33) — not the full core set.
// owner + treasury = deployer on these splitter-only chains, because the team
// Safe multisig exists only on Polygon (using it here would strand control/fees).
// Migrating these to a per-chain multisig is a separate ticket (AIFINP-37).
const ZERO = ethers.ZeroAddress;

// Per-chain USDC/USDT (address(0) = token not supported on that chain -> native only).
const TOKENS: Record<number, { usdc: string; usdt: string; label: string }> = {
  677: {
    usdc: ZERO,
    usdt: ethers.getAddress("0xababc7ddc03e501d190c676bf3d92ef0e6e87a3c"),
    label: "BOT Chain (USDT only)",
  },
  1440000: {
    usdc: ZERO,
    usdt: ZERO,
    label: "XRPL EVM (native only)",
  },
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = Number(network.config.chainId);
  const bal = await ethers.provider.getBalance(deployer.address);

  console.log(`Network:  ${network.name} (chainId ${chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(bal)} native`);

  const cfg = TOKENS[chainId];
  if (!cfg) throw new Error(`No token config for chainId ${chainId} — refusing to deploy blind.`);

  const owner = deployer.address;
  const treasury = deployer.address;
  console.log(`\n${cfg.label}`);
  console.log(`Constructor args:`);
  console.log(`  owner    = ${owner}`);
  console.log(`  treasury = ${treasury}`);
  console.log(`  usdc     = ${cfg.usdc}`);
  console.log(`  usdt     = ${cfg.usdt}`);

  const Factory = await ethers.getContractFactory("B2BSplitter");
  const splitter = await Factory.deploy(owner, treasury, cfg.usdc, cfg.usdt);
  console.log(`\nDeploy tx: ${splitter.deploymentTransaction()?.hash}`);
  await splitter.waitForDeployment();
  const addr = await splitter.getAddress();

  console.log(`\n✅ B2BSplitter v1.2 deployed: ${addr}`);
  // read-back sanity check
  console.log(`   USDC()      = ${await splitter.USDC()}`);
  console.log(`   USDT()      = ${await splitter.USDT()}`);
  console.log(`   treasury()  = ${await splitter.treasury()}`);
  console.log(`   owner()     = ${await splitter.owner()}`);
  console.log(`   treasuryBps = ${await splitter.treasuryBps()}, ipCreatorBps = ${await splitter.ipCreatorBps()}`);
  console.log(`\nRECORD: ${network.name} B2BSplitter v1.2 = ${addr}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
