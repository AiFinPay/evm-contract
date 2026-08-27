import { network } from "hardhat";
import { DeploymentRecord } from "./lib/types.js";
import {
  computeRuntimeCodeHash,
  getDeployerInfo,
  writeDeploymentRecord,
} from "./lib/deployment.js";

const { ethers, networkName } = await network.create();

/**
 * Deploys B2BSplitter v1.3 (gross-inclusive settlement).
 *
 * Two things are deliberately stricter than the v1.2 script.
 *
 * 1. **Ownership must be a contract on every chain.** v1.2 fell back to the
 *    deployer EOA wherever no Safe existed, which is how Optimism, BOT Chain
 *    and XRPL EVM ended up owned by `0x1D5e…fAB9` while Polygon was
 *    Safe-owned. This script refuses to deploy without a configured owner
 *    that has code. Add the chain's Safe below rather than removing the check.
 *
 * 2. **Nothing is written to the canonical registry here.** A deployment is
 *    not a verified route. The address, runtime code hash and constructor
 *    arguments are written to `deployments/` as evidence; promoting that into
 *    the SDK's payment-target registry is a separate reviewed step that
 *    happens after on-chain verification.
 *
 * The selected profile splits its configured fee legs FROM the one gross payer
 * amount. This script does not deploy fee-on-top semantics.
 *
 * Run against a fork first:
 *   npx hardhat run scripts/deploy-splitter-v13.ts --network <name>
 */
const ZERO = ethers.ZeroAddress;

/**
 * Owner and treasury per chain. Both must be contracts (Safe multisigs).
 *
 * Only Polygon's Safe is known to exist today; the other entries are the
 * addresses that must be created and filled in before those chains can be
 * deployed. An empty entry is a deliberate blocker, not an oversight.
 */
const SAFE_POLYGON = ethers.getAddress("0xD31d82c4b35DABaA2ad7023C89A78A052D1f3c8e");
const GOVERNANCE: Record<number, { owner: string; treasury: string }> = {
  137: { owner: SAFE_POLYGON, treasury: SAFE_POLYGON },
};

// TESTNET (dev branch only): Polygon Amoy governance comes from the
// AMOY_TEST_SAFE env var — a real 2-of-2 Safe deployed by
// scripts/deploy-safe-amoy.ts. Env-driven so no throwaway address is
// committed; the owner-must-be-a-contract check below still applies in full.
if (process.env.AMOY_TEST_SAFE) {
  const amoySafe = ethers.getAddress(process.env.AMOY_TEST_SAFE);
  GOVERNANCE[80002] = { owner: amoySafe, treasury: amoySafe };
}

/** Per-chain USDC/USDT. address(0) means the token is unsupported → native only. */
/**
 * SUPERSEDED — this script must not deploy. Use deploy-splitter-v13-production.ts.
 *
 * The table below disagrees with the chain. It names USDT on Polygon, Optimism
 * and BOT Chain; none of the three is whitelisted on the live v1.3 splitters
 * (read 2026-08-27). It also has no entry for BNB Chain, Unichain, Base,
 * Arbitrum or Avalanche, so it refuses five of the nine chains v1.3 runs on.
 *
 * The live routes were deployed from scripts/v13-production-config.ts, which
 * requires an explicit ALLOW_STABLE_OVERRIDE before accepting any address from
 * the environment. This file has no such gate, and two documents pointed
 * operators straight at it for the pending mainnet deploy.
 *
 * Left in place rather than deleted only because the fee-profile logic below is
 * still referenced; the guard is what stops it being run. Deleting it is the
 * tidier follow-up once that is confirmed.
 */
// Returns void rather than never on purpose: a never return makes TypeScript
// treat the whole rest of main() as unreachable, and every downstream type
// collapses to never. The guard should stop the script, not the type checker.
function refuseSupersededDeploy(): void {
  throw new Error(
    "scripts/deploy-splitter-v13.ts is superseded and its stablecoin table does not " +
    "match the deployed v1.3 routes. Use scripts/deploy-splitter-v13-production.ts, " +
    "which reads scripts/v13-production-config.ts.",
  );
}

const TOKENS: Record<number, { usdc: string; usdt: string; label: string }> = {
  137: {
    usdc: ethers.getAddress("0x3c499c542cef5e3811e1192ce70d8cc03d5c3359"),
    usdt: ethers.getAddress("0xc2132d05d31c914a87c6611c10748aeb04b58e8f"),
    label: "Polygon (USDC + USDT, both 6dp)",
  },
  10: {
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
  // TESTNET (dev branch only). The USDC slot is Circle's real Amoy USDC, so
  // the stablecoin path is wired against the genuine 6-decimal token the
  // mainnet procedure will use. The USDT slot takes a freely-mintable mock
  // via AMOY_TEST_STABLE, because Circle's faucet is rate-limited and a paid
  // E2E cannot be scheduled around it. Unset leaves the slot closed.
  80002: {
    usdc: ethers.getAddress("0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582"),
    usdt: process.env.AMOY_TEST_STABLE ? ethers.getAddress(process.env.AMOY_TEST_STABLE) : ZERO,
    label: "Polygon Amoy TESTNET (Circle USDC + mintable mock in USDT slot)",
  },
};

/**
 * Fee profiles.
 *
 * The economic model is a deployment input, never a compiled-in default. A
 * splitter carries one split, so the 0 bps agent route and a fee-bearing
 * monetisation route are separate deployments with separate evidence.
 * All configured fee legs are deducted from gross; none is added above gross.
 *
 * Selected with FEE_PROFILE=<name>. There is deliberately no default: an
 * unset profile aborts the deploy rather than silently inheriting a model
 * that may already have been superseded.
 */
const FEE_PROFILES: Record<string, { treasuryBps: number; ipCreatorBps: number; note: string }> = {
  "agent-x402": {
    treasuryBps: 0,
    ipCreatorBps: 0,
    note: "AIFP-2 / x402 agent payments — provider receives 100% of gross; AiFinPay percentage is 0%.",
  },
  "merchant-aifp1": {
    treasuryBps: 100,
    ipCreatorBps: 0,
    note: "AIFP-1 merchant AI-traffic monetisation — 1% AiFinPay is split from gross, merchant receives 99%, creator fee is 0%.",
  },
};

function resolveFeeProfile(): { name: string; treasuryBps: number; ipCreatorBps: number; note: string } {
  const name = process.env.FEE_PROFILE;
  if (!name) {
    throw new Error(
      `FEE_PROFILE is not set — refusing to deploy without an explicit economic model. ` +
        `Known profiles: ${Object.keys(FEE_PROFILES).join(", ")}.`,
    );
  }
  const profile = FEE_PROFILES[name];
  if (!profile) {
    throw new Error(`Unknown FEE_PROFILE "${name}". Known profiles: ${Object.keys(FEE_PROFILES).join(", ")}.`);
  }
  return { name, ...profile };
}

/**
 * Decimals read from each token contract at deploy time.
 *
 * Not asserted against a hardcoded 6: BNB Chain's USDC is 18 decimals, and an
 * assumption baked in here is exactly the kind of thing that produces a
 * payment a million times too small. This records what the chain says.
 */
async function readDecimals(token: string): Promise<number | null> {
  if (token === ZERO) return null;
  const erc20 = new ethers.Contract(token, ["function decimals() view returns (uint8)"], ethers.provider);
  return Number(await erc20.decimals());
}

async function main() {
  // Refuses before reading anything, so no environment, key or network is
  // touched. An operator following the old runbook gets the pointer, not a
  // deployment configured from a table that does not match the chain.
  refuseSupersededDeploy();

  // Resolved first so a missing or unknown profile fails before any network work.
  const fee = resolveFeeProfile();

  const { chainId } = await getDeployerInfo(ethers, networkName);

  const cfg = TOKENS[chainId];
  if (!cfg) throw new Error(`No token config for chainId ${chainId} — refusing to deploy blind.`);

  const gov = GOVERNANCE[chainId];
  if (!gov) {
    throw new Error(
      `No governance configured for chainId ${chainId}. v1.3 will not deploy to an EOA owner — ` +
        `create the chain's Safe, add it to GOVERNANCE, and re-run.`
    );
  }
  for (const [role, address] of [
    ["owner", gov.owner],
    ["treasury", gov.treasury],
  ] as const) {
    const code = await ethers.provider.getCode(address);
    if (code === "0x") {
      throw new Error(`${role} ${address} has no code on chain ${chainId} — refusing to deploy.`);
    }
  }

  const usdcDecimals = await readDecimals(cfg.usdc);
  const usdtDecimals = await readDecimals(cfg.usdt);

  console.log(`\n${cfg.label}`);
  console.log(`Fee profile: ${fee.name} — ${fee.note}`);
  console.log(`Constructor args:`);
  console.log(`  owner          = ${gov.owner}`);
  console.log(`  treasury       = ${gov.treasury}`);
  console.log(`  usdc           = ${cfg.usdc} (decimals: ${usdcDecimals ?? "n/a"})`);
  console.log(`  usdt           = ${cfg.usdt} (decimals: ${usdtDecimals ?? "n/a"})`);
  console.log(`  treasuryBps    = ${fee.treasuryBps}`);
  console.log(`  ipCreatorBps   = ${fee.ipCreatorBps}`);

  const Factory = await ethers.getContractFactory("B2BSplitterV13");
  const splitter = await Factory.deploy({
    initialOwner: gov.owner,
    treasury: gov.treasury,
    stablecoins: [cfg.usdc, cfg.usdt],
    treasuryBps: fee.treasuryBps,
    ipCreatorBps: fee.ipCreatorBps,
  });
  console.log(`\nDeploy tx: ${splitter.deploymentTransaction()?.hash}`);
  await splitter.waitForDeployment();
  const addr = await splitter.getAddress();

  // The registry pins the runtime code hash, so it is recorded here rather
  // than recomputed later from a build that may not match what is on-chain.
  const runtimeCodeHash = await computeRuntimeCodeHash(ethers, addr);

  // Read the split back from the chain and assert it matches the profile that
  // was asked for. A deployment whose economic model does not match its own
  // evidence is worse than no deployment, so this aborts rather than records.
  const onChainTreasuryBps = Number(await splitter.treasuryBps());
  const onChainIpCreatorBps = Number(await splitter.ipCreatorBps());
  if (onChainTreasuryBps !== fee.treasuryBps || onChainIpCreatorBps !== fee.ipCreatorBps) {
    throw new Error(
      `Deployed split does not match profile "${fee.name}": ` +
        `chain reports ${onChainTreasuryBps}/${onChainIpCreatorBps}, ` +
        `expected ${fee.treasuryBps}/${fee.ipCreatorBps}.`,
    );
  }

  const deploymentRecord: Omit<DeploymentRecord, "timestamp"> & Record<string, unknown> = {
    network: networkName,
    chainId,
    splitterVersion: "1.3",
    splitter: {
      address: addr,
      owner: gov.owner,
      treasury: gov.treasury,
      usdc: cfg.usdc,
      usdt: cfg.usdt,
    },
    runtimeCodeHash,
    tokenDecimals: { usdc: usdcDecimals, usdt: usdtDecimals },
    // Staged, NOT active. Promoting this into the SDK registry is a separate
    // reviewed step that requires verified on-chain evidence first.
    registryEntryStaged: {
      chainId,
      version: "1.3",
      splitter: addr,
      runtimeCodeHash,
      treasury: gov.treasury,
      feeProfile: fee.name,
      treasuryBps: onChainTreasuryBps,
      ipCreatorBps: onChainIpCreatorBps,
      enabled: false,
    },
  };

  writeDeploymentRecord(networkName, chainId, deploymentRecord, "v13-latest");

  console.log(`\n✅ B2BSplitterV13 deployed: ${addr}`);
  console.log(`   runtimeCodeHash = ${runtimeCodeHash}`);
  console.log(`   USDC whitelist  = ${await splitter.whitelistedTokens(cfg.usdc)}`);
  console.log(`   USDT whitelist  = ${await splitter.whitelistedTokens(cfg.usdt)}`);
  console.log(`   treasury()      = ${await splitter.treasury()}`);
  console.log(`   owner()         = ${await splitter.owner()}`);
  console.log(
    `   treasuryBps     = ${await splitter.treasuryBps()}, ipCreatorBps = ${await splitter.ipCreatorBps()}`
  );

  console.log(`\nVerify source:`);
  console.log(
    `  npx hardhat verify --network ${networkName} ${addr} "${gov.owner}" "${gov.treasury}" "${cfg.usdc},${cfg.usdt}" ${fee.treasuryBps} ${fee.ipCreatorBps}`
  );
  console.log(`\nRegistry entry is STAGED and disabled. Do not enable it until:`);
  console.log(`  1. source verification succeeded on the explorer,`);
  console.log(`  2. runtimeCodeHash above matches the registry entry, and`);
  console.log(`  3. a paid end-to-end settlement has been observed on this chain.`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
