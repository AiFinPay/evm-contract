import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deploymentsDir = path.join(root, "deployments");
const files = fs
  .readdirSync(deploymentsDir)
  .filter((file) => /^(.+)-v14-\1-latest\.json$/.test(file))
  .sort();
const expected = new Set([
  "amoy",
  "arbitrum",
  "avalanche",
  "base",
  "bnb",
  "optimism",
  "polygon",
  "robinhood",
  "unichain",
  "xrplevm",
]);
const zeroAddress = "0x0000000000000000000000000000000000000000";

function fail(file, message) {
  throw new Error(`${file}: ${message}`);
}

for (const file of files) {
  const record = JSON.parse(fs.readFileSync(path.join(deploymentsDir, file), "utf8"));
  expected.delete(record.network);
  if (record.network === "botchain") fail(file, "BOT Chain v1.4 is forbidden by ADR-0001");
  if (record.splitterVersion !== "1.4" || !Number.isInteger(record.chainId)) {
    fail(file, "invalid version or chainId");
  }
  if (!record.splitter) fail(file, "missing splitter payload");

  const componentAddresses = [
    record.splitter.address,
    record.splitter.tokenList,
    record.splitter.profiles,
  ];
  for (const address of componentAddresses) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address) || address.toLowerCase() === zeroAddress) {
      fail(file, `invalid component address ${address}`);
    }
  }

  const componentsAreDistinct =
    new Set(componentAddresses.map((address) => address.toLowerCase())).size === 3;
  if (!componentsAreDistinct && record.status !== "invalid") {
    fail(file, "component addresses overlap without status=invalid");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(record.runtimeCodeHash ?? "")) {
    fail(file, "missing or invalid runtimeCodeHash");
  }

  if (record.network === "amoy") {
    if (record.status !== "enabled" || record.settlementEnabled !== true) {
      fail(file, "Amoy must be explicitly enabled for test settlement");
    }
  } else if (
    record.settlementEnabled !== false ||
    !["disabled", "invalid"].includes(record.status) ||
    !record.disabledReason
  ) {
    fail(file, "production deployment must be explicitly quarantined with a reason");
  }

  const assets = Array.isArray(record.splitter.stablecoins)
    ? record.splitter.stablecoins
    : [
        { symbol: "USDC", address: record.splitter.usdc },
        { symbol: "USDT", address: record.splitter.usdt },
      ].filter((asset) => asset.address && asset.address.toLowerCase() !== zeroAddress);
  for (const asset of assets) {
    if (!asset.symbol || !/^0x[0-9a-fA-F]{40}$/.test(asset.address)) {
      fail(file, "invalid stablecoin entry");
    }
  }

  if (record.network === "polygon") {
    const bridgedUsdc = assets.find(
      (asset) => asset.address.toLowerCase() === "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
    );
    if (bridgedUsdc?.symbol !== "USDC.e") fail(file, "0x2791… must be USDC.e, not USDT");
  }
  if (record.network === "robinhood" && assets.length !== 0) {
    fail(file, "record must reflect the currently empty on-chain TokenList");
  }
}

if (expected.size > 0) throw new Error(`Missing v1.4 latest records: ${[...expected].join(", ")}`);
console.log(`Validated ${files.length} v1.4 deployment records; production remains fail-closed.`);
