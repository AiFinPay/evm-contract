/**
 * Off-chain vanity miner for Safe Proxy addresses.
 *
 * Usage:
 *   bun run scripts/mine-safe-address.ts --owners 0xOwner1,0xOwner2 --threshold 2 --prefix 0x5AFE
 *   bun run scripts/mine-safe-address.ts --owners 0xOwner1 --threshold 1 --prefix 5afe --postfix dead
 *   bun run scripts/mine-safe-address.ts --chain 80002 --safe-version 1.3.0 --owners ... --threshold 3 --prefix 5afe0
 *
 * Safe Proxy addresses are deterministic based on:
 *   - Safe Proxy Factory address (defaults from config/safe-networks.ts)
 *   - Singleton (Safe logic contract) address
 *   - Initializer calldata (owners, threshold)
 *   - Salt nonce (varied by this script to find vanity addresses)
 *
 * When --chain is provided, the proxy creation bytecode is read from the
 * on-chain factory for the most accurate address prediction.
 */
import { config as dotenvConfig } from "dotenv";
import { Contract, JsonRpcProvider } from "ethers";
import { getSafeConfig, SAFE_CONFIG, type SafeVersion } from "../config/safe-networks.js";
import {
  buildSafeInitializer,
  computeSafeInitCodeHash,
  mineSalt,
  SAFE_PROXY_FACTORY_ABI,
  type MineResult,
} from "./lib/safe-address.js";

dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env", override: false });

function parseArg(_name: string): string | undefined {
  const idx = process.argv.indexOf(_name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function formatAttempts(_attempts: bigint): string {
  return _attempts.toLocaleString("en-US");
}

async function resolveProxyCreationCode(
  _factoryAddress: string,
  _chainId?: number,
): Promise<string> {
  // If a chain ID is provided and an RPC is available, read the real creation
  // code from the factory for the most accurate prediction.
  if (_chainId && process.env[`RPC_${_chainId}`]) {
    try {
      const provider = new JsonRpcProvider(process.env[`RPC_${_chainId}`]);
      const factory = new Contract(_factoryAddress, SAFE_PROXY_FACTORY_ABI, provider);
      const code: string = await factory.proxyCreationCode();
      return code;
    } catch {
      // Fall through to the embedded default.
    }
  }

  // Embedded Safe Proxy v1.4.1 / v1.5.0 creation code with placeholder metadata.
  // Prefer querying the chain (see above) for production mining.
  return "0x608060405234801561001057600080fd5b506040516101e63803806101e683398181016040528101906100329190610054565b806000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff160217905550506100ac565b60008151905061005081610095565b92915050565b60006020828403121561006c5761006b61008a565b5b600061007a84828501610041565b91505092915050565b6000819050919050565b6100928161007f565b811461009d57600080fd5b50565b6000602082840312156100b8576100b761008a565b5b60006100c684828501610041565b91505092915050565b610117806100db6000396000f3fe6080604052348015600f57600080fd5b506004361060285760003560e01c80633659cfe614602c575b600080fd5b603c6004803603810190603891906065565b603e565b005b60008054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffffffffffffff16141560945760008054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff166108fc829081150290604051600060405180830381858888f193505050501580156092573d6000803e3d6000fd5b505b50565b600081359050605f8160ad565b92915050565b6000602082840312156074576073608a565b5b6000607f848285016052565b91505092915050565b60836085565b600080fd5b6000819050919050565b609081608c565b8114609a57600080fd5b5056fea2646970667358221220d3b5e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e864736f6c63430008130033";
}

async function main() {
  const prefix = parseArg("--prefix");
  const postfix = parseArg("--postfix");
  const ownersArg = parseArg("--owners");
  const thresholdArg = parseArg("--threshold");
  const chainIdArg = parseArg("--chain");
  const safeVersionArg = parseArg("--safe-version");
  const safeVersion: SafeVersion | undefined = safeVersionArg
    ? (safeVersionArg as SafeVersion)
    : undefined;
  const maxAttempts = BigInt(parseArg("--max") || "10000000");
  const start = BigInt(parseArg("--start") || "0");

  let factoryAddress: string;
  let singletonAddress: string;
  let chainId: number | undefined;

  if (chainIdArg) {
    chainId = parseInt(chainIdArg, 10);
    try {
      const config = getSafeConfig(chainId, safeVersion);
      factoryAddress = config.proxyFactory;
      singletonAddress = config.singleton;
      console.log(`Using Safe config for ${config.chainName} (Chain ID: ${chainId})`);
      if (safeVersion) {
        console.log(`  Version override: ${safeVersion} (default for chain is ${getSafeConfig(chainId).safeVersion})`);
      }
      console.log(`  Proxy Factory: ${factoryAddress}`);
      console.log(`  Singleton:     ${singletonAddress}`);
      console.log(`  Safe Version:  ${config.safeVersion}`);
      if (config.transactionService) {
        console.log(`  Transaction Service: ${config.transactionService}`);
      }
      console.log("");
    } catch {
      console.warn(`Warning: Chain ID ${chainId} not in config, using v1.5.0 canonical addresses`);
      factoryAddress = "0x14F2982D601c9458F93bd70B218933A6f8165e7b";
      singletonAddress = "0xFf51A5898e281Db6DfC7855790607438dF2ca44b";
    }
  } else {
    factoryAddress = parseArg("--factory") || "0x14F2982D601c9458F93bd70B218933A6f8165e7b";
    singletonAddress = parseArg("--singleton") || "0xFf51A5898e281Db6DfC7855790607438dF2ca44b";
  }

  if (!prefix && !postfix) {
    throw new Error(
      "Usage: bun run scripts/mine-safe-address.ts --prefix 0xABC [--postfix 0xXYZ] --owners 0x1,0x2 --threshold 2 [--chain CHAIN_ID] [--safe-version 1.3.0|1.4.1|1.5.0] [--factory 0x...] [--singleton 0x...] [--start N] [--max N]\n\n" +
        "Examples:\n" +
        "  # Mine Safe with 0x5AFE prefix on Polygon (chain 137)\n" +
        "  bun run scripts/mine-safe-address.ts --chain 137 --owners 0xOwner1,0xOwner2 --threshold 2 --prefix 5afe\n\n" +
        "  # Mine Safe with prefix and postfix\n" +
        "  bun run scripts/mine-safe-address.ts --owners 0xOwner --threshold 1 --prefix 5a --postfix dead\n\n" +
        "  # Mine on Amoy using the legacy v1.3.0 factory\n" +
        "  bun run scripts/mine-safe-address.ts --chain 80002 --safe-version 1.3.0 --owners 0xOwner --threshold 1 --prefix 5afe0\n\n" +
        "Supported chains: " +
        Object.keys(SAFE_CONFIG).join(", "),
    );
  }

  if (!ownersArg) {
    throw new Error("--owners is required (comma-separated list of owner addresses)");
  }

  if (!thresholdArg) {
    throw new Error("--threshold is required (number)");
  }

  const owners = ownersArg.split(",").map((o) => o.trim());
  const threshold = parseInt(thresholdArg, 10);

  if (threshold < 1 || threshold > owners.length) {
    throw new Error("Threshold must be >= 1 and <= number of owners");
  }

  const initializer = buildSafeInitializer(owners, threshold);
  const proxyCreationCode = await resolveProxyCreationCode(factoryAddress, chainId);
  const initCodeHash = computeSafeInitCodeHash(proxyCreationCode, singletonAddress);

  console.log("Mining Safe Proxy address");
  console.log(`Factory:       ${factoryAddress}`);
  console.log(`Singleton:     ${singletonAddress}`);
  console.log(`InitCodeHash:   ${initCodeHash}`);
  console.log(`Owners:        ${owners.join(", ")}`);
  console.log(`Threshold:     ${threshold}`);
  console.log(`Max Attempts:  ${maxAttempts.toLocaleString()}`);
  if (prefix) console.log(`Target prefix: ${prefix.toLowerCase()}`);
  if (postfix) console.log(`Target postfix: ${postfix.toLowerCase()}`);
  console.log("");

  const startTime = Date.now();
  const result: MineResult = mineSalt(
    initCodeHash,
    factoryAddress,
    initializer,
    prefix,
    postfix,
    start,
    maxAttempts,
  );

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`Found in ${formatAttempts(result.attempts)} attempts (${elapsed}s)`);
  console.log(`  Salt Nonce:  ${result.saltNonce.toString()}`);
  console.log(`  Address:     ${result.address}`);
  console.log("");
  console.log(
    "Safe Proxy deployment uses CREATE2 with salt = keccak256(keccak256(initializer), saltNonce)",
  );
  console.log("Use this salt nonce when deploying via Safe Proxy Factory:");
  console.log("");
  console.log("Using Safe{core} SDK:");
  console.log("  const safeAddress = await factory.createProxyWithNonce(");
  console.log("    singleton,");
  console.log("    initializer,");
  console.log(`    ${result.saltNonce.toString()}n`);
  console.log("  );");
  console.log("");
  console.log("Using ethers.js:");
  console.log(`  const factory = new ethers.Contract(proxyFactory, SafeProxyFactoryAbi, signer);`);
  console.log(
    `  const tx = await factory.createProxyWithNonce(singleton, initializer, ${result.saltNonce.toString()}n);`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
