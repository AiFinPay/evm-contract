import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";
import { ZeroAddress, isAddress, keccak256 } from "ethers";
import type { DeploymentRecord } from "./lib/types.js";
import { routeIdsV14 } from "../config/v14-production-config.js";

const { ethers, networkName } = await network.create();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function status(_ok: boolean, _msg: string): string {
  return `${_ok ? "✅" : "❌"} ${_msg}`;
}

async function hasCode(_address: string, _label: string): Promise<boolean> {
  const code = await ethers.provider.getCode(_address);
  const ok = code.length > 2;
  console.log(status(ok, `${_label} (${_address}) has runtime code`));
  return ok;
}

function configuredStablecoins(
  record: DeploymentRecord,
): Array<{ symbol: string; address: string }> {
  const splitter = record.splitter;
  if (!splitter) return [];
  if (Array.isArray(splitter.stablecoins)) return splitter.stablecoins;

  // Backwards-compatible reader for records written before the generic asset schema.
  return [
    { symbol: "USDC", address: splitter.usdc ?? ZeroAddress },
    { symbol: "USDT", address: splitter.usdt ?? ZeroAddress },
  ].filter((asset) => asset.address !== ZeroAddress);
}

async function main() {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const deploymentsDir = path.join(__dirname, "../deployments");
  const candidates = [
    `${networkName}-v14-${networkName}-latest.json`,
    `${networkName}-v14-latest.json`,
    `${networkName}-latest.json`,
  ];
  let record: DeploymentRecord | undefined;
  for (const file of candidates) {
    const p = path.join(deploymentsDir, file);
    if (fs.existsSync(p)) {
      record = JSON.parse(fs.readFileSync(p, "utf8")) as DeploymentRecord;
      console.log(`Using deployment record: ${file}\n`);
      break;
    }
  }
  if (!record) {
    throw new Error(`No v1.4 deployment record found for network "${networkName}".`);
  }

  if (record.chainId !== chainId) {
    throw new Error(
      `Deployment record chainId (${record.chainId}) does not match current network (${chainId}).`,
    );
  }

  if (!record.splitter) {
    throw new Error("Deployment record does not contain a v1.4 splitter payload.");
  }

  const s = record.splitter;
  let ok = true;

  console.log(`Network:  ${networkName} (chainId ${chainId})`);
  console.log(`Record:   ${record.timestamp}\n`);

  // ── Contract existence ──
  console.log("--- Contract existence ---");
  ok &&= await hasCode(s.address, "B2BSplitterV14");
  ok &&= await hasCode(s.tokenList, "TokenList");
  ok &&= await hasCode(s.profiles, "Profiles");

  const runtimeCode = await ethers.provider.getCode(s.address);
  const actualRuntimeCodeHash = runtimeCode.length > 2 ? keccak256(runtimeCode) : null;
  const runtimeHashMatches =
    typeof record.runtimeCodeHash === "string" &&
    actualRuntimeCodeHash?.toLowerCase() === record.runtimeCodeHash.toLowerCase();
  console.log(
    status(
      runtimeHashMatches,
      `runtime code hash = ${actualRuntimeCodeHash ?? "no code"} (record: ${record.runtimeCodeHash ?? "missing"})`,
    ),
  );
  ok &&= runtimeHashMatches;

  // ── Address validity ──
  console.log("\n--- Address validity ---");
  for (const [label, addr] of Object.entries({
    admin: s.admin,
    signer: s.signer,
    pauser: s.pauser,
    treasury: s.treasury,
    tokenList: s.tokenList,
    profiles: s.profiles,
    ...Object.fromEntries(
      configuredStablecoins(record).map((asset) => [`asset ${asset.symbol}`, asset.address]),
    ),
  })) {
    const valid = isAddress(addr) && addr.toLowerCase() !== ZeroAddress;
    console.log(status(valid, `${label}: ${addr}`));
    ok &&= valid;
  }

  const contractAddresses = [s.address, s.tokenList, s.profiles].map((address) =>
    address.toLowerCase(),
  );
  const contractsAreDistinct = new Set(contractAddresses).size === contractAddresses.length;
  console.log(
    status(contractsAreDistinct, "splitter, TokenList and Profiles addresses are distinct"),
  );
  ok &&= contractsAreDistinct;

  // ── B2BSplitterV14 state ──
  console.log("\n--- B2BSplitterV14 ---");
  const splitter = await ethers.getContractAt("B2BSplitterV14", s.address);
  const tokenList = await ethers.getContractAt("TokenList", s.tokenList);
  const profiles = await ethers.getContractAt("Profiles", s.profiles);

  const tokenListOnChain = await splitter.tokenList();
  const profilesOnChain = await splitter.profiles();
  const treasuryOnChain = await splitter.treasury();

  const tokenListMatch = tokenListOnChain.toLowerCase() === s.tokenList.toLowerCase();
  const profilesMatch = profilesOnChain.toLowerCase() === s.profiles.toLowerCase();
  const treasuryMatch = treasuryOnChain.toLowerCase() === s.treasury.toLowerCase();

  console.log(status(tokenListMatch, `tokenList() = ${tokenListOnChain}`));
  console.log(status(profilesMatch, `profiles() = ${profilesOnChain}`));
  console.log(status(treasuryMatch, `treasury() = ${treasuryOnChain}`));
  ok &&= tokenListMatch && profilesMatch && treasuryMatch;

  // ── Roles ──
  const adminRole = await splitter.ADMIN_ROLE();
  const signerRole = await splitter.SIGN_OPERATOR_ROLE();
  const pauserRole = await splitter.PAUSER_ROLE();

  const hasAdmin = await splitter.hasRole(adminRole, s.admin);
  const hasSigner = await splitter.hasRole(signerRole, s.signer);
  const hasPauser = await splitter.hasRole(pauserRole, s.pauser);

  console.log(status(hasAdmin, `ADMIN_ROLE granted to ${s.admin}`));
  console.log(status(hasSigner, `SIGN_OPERATOR_ROLE granted to ${s.signer}`));
  console.log(status(hasPauser, `PAUSER_ROLE granted to ${s.pauser}`));
  ok &&= hasAdmin && hasSigner && hasPauser;

  // ── Deployer / admin separation ──
  const deployerAddress = process.env.AIFINPAY_DEPLOYER_ADDRESS?.trim();
  const defaultAdminRole = ethers.ZeroHash;

  if (deployerAddress) {
    if (!isAddress(deployerAddress) || deployerAddress.toLowerCase() === ZeroAddress) {
      throw new Error("AIFINPAY_DEPLOYER_ADDRESS is not a valid non-zero address.");
    }
    const splitterDeployerIsAdmin = deployerAddress.toLowerCase() === s.admin.toLowerCase();
    const splitterDeployerHasAdmin = await splitter.hasRole(adminRole, deployerAddress);
    if (splitterDeployerIsAdmin || splitterDeployerHasAdmin) {
      console.warn(
        `⚠️  Deployer ${deployerAddress} holds ADMIN_ROLE on B2BSplitterV14. ` +
          `For production governance, ADMIN_ROLE should be transferred to a Safe/Timelock and renounced by the deployer.`,
      );
    }
  } else {
    console.log("  Deployer role check skipped (AIFINPAY_DEPLOYER_ADDRESS not set).");
  }

  // ── Paused state ──
  const paused = await splitter.paused?.().catch(() => undefined);
  if (paused !== undefined) {
    console.log(status(!paused, `contract paused = ${paused}`));
    ok &&= !paused;
  }

  // ── TokenList ──
  console.log("\n--- TokenList ---");
  const tokenListAdminOk = await tokenList.hasRole(defaultAdminRole, s.admin);
  console.log(status(tokenListAdminOk, `DEFAULT_ADMIN_ROLE granted to ${s.admin}`));
  if (deployerAddress && (await tokenList.hasRole(defaultAdminRole, deployerAddress))) {
    console.warn(
      `⚠️  Deployer ${deployerAddress} holds DEFAULT_ADMIN_ROLE on TokenList. ` +
        `Transfer admin to the governance Safe and renounce the deployer.`,
    );
  }
  ok &&= tokenListAdminOk;

  const zeroAddressAllowed = await tokenList.isAllowed(ZeroAddress);
  console.log(status(!zeroAddressAllowed, "address(0) is not allowed"));
  ok &&= !zeroAddressAllowed;

  for (const { symbol, address } of configuredStablecoins(record)) {
    const allowed = await tokenList.isAllowed(address);
    console.log(status(allowed, `${symbol} (${address}) is allowed`));
    ok &&= allowed;
  }

  // ── Profiles ──
  console.log("\n--- Profiles ---");
  const profilesAdminOk = await profiles.hasRole(defaultAdminRole, s.admin);
  console.log(status(profilesAdminOk, `DEFAULT_ADMIN_ROLE granted to ${s.admin}`));
  if (deployerAddress && (await profiles.hasRole(defaultAdminRole, deployerAddress))) {
    console.warn(
      `⚠️  Deployer ${deployerAddress} holds DEFAULT_ADMIN_ROLE on Profiles. ` +
        `Transfer admin to the governance Safe and renounce the deployer.`,
    );
  }
  ok &&= profilesAdminOk;

  const routeIds = await profiles.routeIds();
  console.log(`  Configured routes: ${routeIds.length}`);
  const expectedRouteIds = routeIdsV14();
  const expectedProfiles = new Map([
    [expectedRouteIds.agent.toLowerCase(), { treasuryBps: 0n, ipCreatorBps: 0n }],
    [expectedRouteIds.merchant.toLowerCase(), { treasuryBps: 100n, ipCreatorBps: 0n }],
  ]);
  const exactRouteSet =
    routeIds.length === expectedProfiles.size &&
    routeIds.every((routeId: string) => expectedProfiles.has(routeId.toLowerCase()));
  console.log(status(exactRouteSet, "enabled route set matches agent-x402 + merchant-aifp1"));
  ok &&= exactRouteSet;
  for (const routeId of routeIds) {
    const profile = await profiles.getProfile(routeId);
    const enabled = await profiles.isEnabled(routeId);
    const expected = expectedProfiles.get(routeId.toLowerCase());
    const economicsMatch =
      expected !== undefined &&
      profile.treasuryBps === expected.treasuryBps &&
      profile.ipCreatorBps === expected.ipCreatorBps &&
      profile.routeTreasury === ZeroAddress;
    console.log(
      status(
        enabled && economicsMatch,
        `route ${routeId}: treasuryBps=${profile.treasuryBps}, ipCreatorBps=${profile.ipCreatorBps}, enabled=${enabled}, treasury=${profile.routeTreasury}`,
      ),
    );
    ok &&= enabled && economicsMatch;
  }

  // ── Summary ──
  console.log("\n--- Summary ---");
  if (ok) {
    console.log("✅ All on-chain checks passed.");
  } else {
    console.log("❌ Some on-chain checks failed.");
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
