import { ethers, network } from "hardhat";

// Deploys ONLY B2BSplitter v1.2 (AIFINP-34/35/33) — not the full core set.
// owner + treasury = deployer on these splitter-only chains, because the team
// Safe multisig exists only on Polygon (using it here would strand control/fees).
// Migrating these to a per-chain multisig is a separate ticket (AIFINP-37).
const ZERO = ethers.ZeroAddress;

// Chains where owner/treasury must NOT be the deployer. Polygon is the only chain
// with a team Safe, and the existing splitter already has owner = treasury = Safe
// (verified on-chain 2026-07-31 on 0xE34Fc0E6…8440). Deploying v1.2 with the
// deployer instead would silently downgrade Polygon from multisig governance to a
// single key — approved as Option A by the founder, keep the Safe.
const SAFE_POLYGON = ethers.getAddress("0xD31d82c4b35DABaA2ad7023C89A78A052D1f3c8e");
const GOVERNANCE: Record<number, { owner: string; treasury: string }> = {
  137: { owner: SAFE_POLYGON, treasury: SAFE_POLYGON },
};

// Per-chain USDC/USDT (address(0) = token not supported on that chain -> native only).
const TOKENS: Record<number, { usdc: string; usdt: string; label: string }> = {
  137: {
    usdc: ethers.getAddress("0x3c499c542cef5e3811e1192ce70d8cc03d5c3359"),
    usdt: ethers.getAddress("0xc2132d05d31c914a87c6611c10748aeb04b58e8f"),
    label: "Polygon (USDC + USDT, both 6dp)",
  },
  10: {
    // symbol()/decimals() read live on Optimism 2026-07-31: USDC 6dp, USDT 6dp
    usdc: ethers.getAddress("0x0b2c639c533813f4aa9d7837caf62653d097ff85"),
    usdt: ethers.getAddress("0x94b008aa00579c1307b0ef2c499ad98a8ce58e58"),
    label: "Optimism (USDC + USDT, both 6dp)",
  },
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

  const gov = GOVERNANCE[chainId];
  const owner = gov?.owner ?? deployer.address;
  const treasury = gov?.treasury ?? deployer.address;
  if (gov) {
    const code = await ethers.provider.getCode(gov.owner);
    if (code === "0x") throw new Error(`Owner ${gov.owner} has no code on chain ${chainId} — refusing to hand ownership to a non-contract.`);
    console.log(`Governance: multisig (owner has ${(code.length - 2) / 2} bytes of code)`);
  }
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
