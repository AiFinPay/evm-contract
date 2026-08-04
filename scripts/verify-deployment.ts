import { Contract, Provider, getAddress, isAddress } from "ethers";
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

export interface DeploymentManifest {
  schemaVersion: 1;
  network: string;
  chainId: number;
  contracts: {
    msecco: string;
    passport: string;
    core: string;
  };
  expected: {
    owner: string;
    treasury: string;
    pyth: string;
    usdc: string;
    usdt: string;
    nativeUsdId: string;
    paused: boolean;
    treasuryBps: number;
    ipCreatorBps: number;
  };
}

const CORE_ABI = [
  "function msecco() view returns (address)",
  "function passport() view returns (address)",
  "function treasury() view returns (address)",
  "function PYTH() view returns (address)",
  "function USDC() view returns (address)",
  "function USDT() view returns (address)",
  "function NATIVE_USD_ID() view returns (bytes32)",
  "function owner() view returns (address)",
  "function isPaused() view returns (bool)",
  "function treasuryBps() view returns (uint256)",
  "function ipCreatorBps() view returns (uint256)",
];
const MSECCO_ABI = [
  "function aifinpayCore() view returns (address)",
  "function owner() view returns (address)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];
const PASSPORT_ABI = [
  "function aifinpayCore() view returns (address)",
  "function owner() view returns (address)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
];

function fail(message: string): never {
  throw new Error(`Deployment verification failed: ${message}`);
}

function assertAddress(label: string, actual: string, expected: string): void {
  if (getAddress(actual) !== getAddress(expected)) {
    fail(`${label}: expected ${expected}, got ${actual}`);
  }
}

function assertValue<T>(label: string, actual: T, expected: T): void {
  if (actual !== expected) fail(`${label}: expected ${expected}, got ${actual}`);
}

export function validateManifest(value: unknown): DeploymentManifest {
  if (!value || typeof value !== "object") fail("manifest is not an object");
  const manifest = value as DeploymentManifest;
  if (manifest.schemaVersion !== 1) fail("unsupported or missing schemaVersion");
  if (!manifest.network || typeof manifest.network !== "string") fail("network is missing");
  if (!Number.isSafeInteger(manifest.chainId) || manifest.chainId <= 0) fail("invalid chainId");
  if (!manifest.contracts || !manifest.expected) fail("contracts/expected section is missing");

  const addresses: Array<[string, unknown]> = [
    ["contracts.msecco", manifest.contracts.msecco],
    ["contracts.passport", manifest.contracts.passport],
    ["contracts.core", manifest.contracts.core],
    ["expected.owner", manifest.expected.owner],
    ["expected.treasury", manifest.expected.treasury],
    ["expected.pyth", manifest.expected.pyth],
    ["expected.usdc", manifest.expected.usdc],
    ["expected.usdt", manifest.expected.usdt],
  ];
  for (const [label, address] of addresses) {
    if (typeof address !== "string" || !isAddress(address) || address === ethers.ZeroAddress) {
      fail(`${label} is not a non-zero address`);
    }
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(manifest.expected.nativeUsdId) || /^0x0{64}$/.test(manifest.expected.nativeUsdId)) {
    fail("expected.nativeUsdId is not a non-zero bytes32 value");
  }
  if (typeof manifest.expected.paused !== "boolean") fail("expected.paused must be boolean");
  for (const key of ["treasuryBps", "ipCreatorBps"] as const) {
    const bps = manifest.expected[key];
    if (!Number.isSafeInteger(bps) || bps < 0 || bps > 10_000) fail(`expected.${key} is invalid`);
  }
  if (manifest.expected.treasuryBps + manifest.expected.ipCreatorBps > 10_000) {
    fail("expected fee sum exceeds 100%");
  }
  return manifest;
}

async function assertCode(provider: Provider, label: string, address: string): Promise<void> {
  const code = await provider.getCode(address);
  if (code === "0x") fail(`${label} ${address} has no deployed code`);
}

export async function verifyDeployment(provider: Provider, value: unknown): Promise<void> {
  const manifest = validateManifest(value);
  const actualChainId = Number((await provider.getNetwork()).chainId);
  assertValue("chainId", actualChainId, manifest.chainId);

  const codeTargets: Array<[string, string]> = [
    ["MSECCOToken", manifest.contracts.msecco],
    ["AgentPassport", manifest.contracts.passport],
    ["AiFinPayCore", manifest.contracts.core],
    ["governance owner", manifest.expected.owner],
    ["treasury", manifest.expected.treasury],
    ["Pyth", manifest.expected.pyth],
    ["USDC", manifest.expected.usdc],
    ["USDT", manifest.expected.usdt],
  ];
  await Promise.all(codeTargets.map(([label, address]) => assertCode(provider, label, address)));

  const core = new Contract(manifest.contracts.core, CORE_ABI, provider);
  const msecco = new Contract(manifest.contracts.msecco, MSECCO_ABI, provider);
  const passport = new Contract(manifest.contracts.passport, PASSPORT_ABI, provider);
  const [
    coreMsecco, corePassport, treasury, pyth, usdc, usdt, nativeUsdId,
    coreOwner, paused, treasuryBps, ipCreatorBps,
    mseccoCore, mseccoOwner, mseccoName, mseccoSymbol, mseccoDecimals,
    passportCore, passportOwner, passportName, passportSymbol,
  ] = await Promise.all([
    core.msecco(), core.passport(), core.treasury(), core.PYTH(), core.USDC(), core.USDT(), core.NATIVE_USD_ID(),
    core.owner(), core.isPaused(), core.treasuryBps(), core.ipCreatorBps(),
    msecco.aifinpayCore(), msecco.owner(), msecco.name(), msecco.symbol(), msecco.decimals(),
    passport.aifinpayCore(), passport.owner(), passport.name(), passport.symbol(),
  ]);

  assertAddress("core.msecco", coreMsecco, manifest.contracts.msecco);
  assertAddress("core.passport", corePassport, manifest.contracts.passport);
  assertAddress("msecco.aifinpayCore", mseccoCore, manifest.contracts.core);
  assertAddress("passport.aifinpayCore", passportCore, manifest.contracts.core);
  assertAddress("core.treasury", treasury, manifest.expected.treasury);
  assertAddress("core.PYTH", pyth, manifest.expected.pyth);
  assertAddress("core.USDC", usdc, manifest.expected.usdc);
  assertAddress("core.USDT", usdt, manifest.expected.usdt);
  assertAddress("core.owner", coreOwner, manifest.expected.owner);
  assertAddress("msecco.owner", mseccoOwner, manifest.expected.owner);
  assertAddress("passport.owner", passportOwner, manifest.expected.owner);
  assertValue("core.NATIVE_USD_ID", String(nativeUsdId).toLowerCase(), manifest.expected.nativeUsdId.toLowerCase());
  assertValue("core.isPaused", paused, manifest.expected.paused);
  assertValue("core.treasuryBps", Number(treasuryBps), manifest.expected.treasuryBps);
  assertValue("core.ipCreatorBps", Number(ipCreatorBps), manifest.expected.ipCreatorBps);
  assertValue("mSECCO name", mseccoName, "mSECCO");
  assertValue("mSECCO symbol", mseccoSymbol, "mSECCO");
  assertValue("mSECCO decimals", Number(mseccoDecimals), 2);
  assertValue("passport name", passportName, "AiFinPay Agent Passport");
  assertValue("passport symbol", passportSymbol, "AIPASS");
}

export function loadManifest(filePath: string): DeploymentManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`cannot read manifest ${filePath}: ${error}`);
  }
  return validateManifest(parsed);
}

async function main(): Promise<void> {
  const manifestPath = process.env.DEPLOYMENT_MANIFEST
    ? path.resolve(process.env.DEPLOYMENT_MANIFEST)
    : path.resolve(__dirname, `../deployments/${network.name}.json`);
  const manifest = loadManifest(manifestPath);
  if (manifest.network !== network.name) {
    fail(`network name: manifest=${manifest.network}, hardhat=${network.name}`);
  }
  await verifyDeployment(ethers.provider, manifest);
  console.log(`PASS ${manifest.network} (${manifest.chainId}): deployment, wiring, governance, tokens, oracle, fees and pause state verified`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
