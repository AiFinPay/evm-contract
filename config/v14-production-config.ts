// Production deployment configuration for B2BSplitter v1.4 across AiFinPay
// EVM networks. Stablecoin defaults are conservative: a non-zero default is
// present only where the issuer's current documentation was verified during
// the v1.4 production-RC review. Overrides require ALLOW_STABLE_OVERRIDE=true.
import { ZeroAddress, keccak256, toUtf8Bytes } from "ethers";
import { canonicalSalt } from "../scripts/lib/create3.js";

export interface Stablecoin {
  address: string;
  symbol: string;
  name: string;
  source?: string | null;
}

export interface V14ProductionNetwork {
  name: string;
  chainId: number;
  stablecoins: Stablecoin[];
  /** Deterministic CREATE3 salts for v1.4 contracts. If null, the deployment scripts
   * fall back to canonicalSalt(deployer, name, version, "0"). */
  salts: {
    TokenList: string | null;
    Profiles: string | null;
    B2BSplitterV14: string | null;
  };
}

const CIRCLE_USDC_SOURCE = "Circle USDC contract-address registry, verified 2026-08-27";
const TETHER_USDT_SOURCE = "Tether supported-protocols registry, verified 2026-08-27";

const CREATE3_SALTS = {
  TokenList: "0x8be94b4c2852b83d5f69de83ba79859073143caceb89a1cdda67fb51455c4606",
  Profiles: "0x03e4e98753532c736568df726806a736af26c4804e3ca72843f800decc23bf40",
  B2BSplitterV14: "0x67969d2c5e97b90856338f2ba2b9b49218ef88a1d28d16473d596b08b1c4f5d8",
} as const;

/**
 * Multisig Safe owners (3-of-4 consensus) shared by all v1.4 networks.
 * Used when creating the Gnosis Safe that holds ADMIN_ROLE via the timelock.
 */
export const MULTISIG_SAFE_OWNERS = [
  "0x25A834b6fEC79e9ee6ED04Ef5b97440149C6Cc24", // Iryna
  "0x2118c57dEBD53f614DDfE464Ff2941BE6646cA82", // Dmitry
  "0x3C31dd9daCeC5473cC9B660CD69247A20701cF19", // Pasha
  "0x588A80e94a762C670711ff77CC60a2e65E64F53A", // Pavlo Bolhar
] as const;

export const MULTISIG_SAFE_THRESHOLD = 3;

export const V14_PRODUCTION_NETWORKS: Record<number, V14ProductionNetwork> = {
  80002: {
    name: "Amoy (testnet)",
    chainId: 80002,
    stablecoins: [
      {
        address: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
        symbol: "USDC",
        name: "USDC",
        source: CIRCLE_USDC_SOURCE,
      },
    ],
    salts: CREATE3_SALTS,
  },
  137: {
    name: "Polygon PoS",
    chainId: 137,
    stablecoins: [
      {
        address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
        symbol: "USDC",
        name: "USDC",
        source: CIRCLE_USDC_SOURCE,
      },
      {
        address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
        symbol: "USDT",
        name: "USDT",
        source: TETHER_USDT_SOURCE,
      },
    ],
    salts: CREATE3_SALTS,
  },
  43114: {
    name: "Avalanche C-Chain",
    chainId: 43114,
    stablecoins: [
      {
        address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
        symbol: "USDC",
        name: "USDC",
        source: CIRCLE_USDC_SOURCE,
      },
      {
        address: "0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7",
        symbol: "USDT",
        name: "USDT",
        source: TETHER_USDT_SOURCE,
      },
    ],
    salts: CREATE3_SALTS,
  },
  42161: {
    name: "Arbitrum One",
    chainId: 42161,
    stablecoins: [
      {
        address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
        symbol: "USDC",
        name: "USDC",
        source: CIRCLE_USDC_SOURCE,
      },
    ],
    salts: CREATE3_SALTS,
  },
  56: {
    name: "BNB Chain",
    chainId: 56,
    stablecoins: [
      { address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", symbol: "USDC", name: "USDC" },
      { address: "0x55d398326f99059fF775485246999027B3197955", symbol: "USDT", name: "USDT" },
    ],
    salts: CREATE3_SALTS,
  },
  8453: {
    name: "Base",
    chainId: 8453,
    stablecoins: [
      {
        address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        symbol: "USDC",
        name: "USDC",
        source: CIRCLE_USDC_SOURCE,
      },
    ],
    salts: CREATE3_SALTS,
  },
  130: {
    name: "Unichain",
    chainId: 130,
    stablecoins: [
      {
        address: "0x078D782b760474a361dDA0AF3839290b0EF57AD6",
        symbol: "USDC",
        name: "USDC",
        source: CIRCLE_USDC_SOURCE,
      },
    ],
    salts: CREATE3_SALTS,
  },
  10: {
    name: "OP Mainnet",
    chainId: 10,
    stablecoins: [
      {
        address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
        symbol: "USDC",
        name: "USDC",
        source: CIRCLE_USDC_SOURCE,
      },
    ],
    salts: CREATE3_SALTS,
  },
  677: {
    name: "BOT Chain",
    chainId: 677,
    stablecoins: [],
    salts: CREATE3_SALTS,
  },
  1440000: {
    name: "XRPL EVM",
    chainId: 1440000,
    stablecoins: [],
    salts: CREATE3_SALTS,
  },
  4663: {
    name: "Robinhood Chain",
    chainId: 4663,
    stablecoins: [
      {
        address: "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34",
        symbol: "USDe",
        name: "USDe",
        source: "Ethena USDe on Robinhood Chain, verified via on-chain symbol/name",
      },
      {
        address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
        symbol: "USDG",
        name: "Global Dollar",
        source: "Paxos Global Dollar on Robinhood Chain, verified via on-chain symbol/name",
      },
    ],
    salts: CREATE3_SALTS,
  },
};

export function configuredStableAddress(chainId: number, symbol: string): string {
  const network = V14_PRODUCTION_NETWORKS[chainId];
  if (!network) throw new Error(`Unsupported AiFinPay v1.4 chainId ${chainId}`);
  const stablecoin = network.stablecoins.find((s) => s.symbol === symbol);
  return stablecoin?.address ?? ZeroAddress;
}

/** Returns all stablecoins configured for a chain. */
export function configuredStablecoins(chainId: number): Stablecoin[] {
  const network = V14_PRODUCTION_NETWORKS[chainId];
  if (!network) throw new Error(`Unsupported AiFinPay v1.4 chainId ${chainId}`);
  return network.stablecoins;
}

/** Returns the stored CREATE3 salt if it is scoped to this deployer, otherwise a canonical fallback. */
export function configuredSalt(
  chainId: number,
  contractName: "TokenList" | "Profiles" | "B2BSplitterV14",
  deployerAddress: string,
): string {
  const network = V14_PRODUCTION_NETWORKS[chainId];
  if (!network) throw new Error(`Unsupported AiFinPay v1.4 chainId ${chainId}`);
  const version = contractName === "B2BSplitterV14" ? "1.4" : "1.0";
  const stored = network.salts[contractName];
  const deployerPrefix = deployerAddress.toLowerCase().slice(2);
  if (stored && stored.toLowerCase().startsWith(deployerPrefix)) {
    return stored;
  }
  if (stored) {
    console.warn(
      `  Warning: stored ${contractName} salt does not match deployer ${deployerAddress}; using canonical salt.`,
    );
  }
  return canonicalSalt(deployerAddress, contractName, version, "0");
}

export function governanceEnv(chainId: number): { admin: string; treasury: string } {
  const admin = process.env[`AIFINPAY_SAFE_${chainId}`]?.trim();
  const treasury = process.env[`AIFINPAY_TREASURY_${chainId}`]?.trim() || admin;
  if (!admin || !treasury) {
    throw new Error(
      `Missing AIFINPAY_SAFE_${chainId}/AIFINPAY_TREASURY_${chainId}. ` +
        `Production v1.4 deployment never falls back to a deployer EOA.`,
    );
  }
  return { admin, treasury };
}

export function initialSignerEnv(): string {
  const signer = process.env.AIFINPAY_V14_SIGNER?.trim();
  if (!signer) {
    throw new Error(
      "AIFINPAY_V14_SIGNER is required — the backend KMS-backed public key that will hold SIGN_OPERATOR_ROLE.",
    );
  }
  return signer;
}

export function pauserEnv(chainId: number, defaultAdmin: string): string {
  const pauser = process.env[`AIFINPAY_PAUSER_${chainId}`]?.trim() || defaultAdmin;
  if (!pauser) {
    throw new Error(
      `Missing AIFINPAY_PAUSER_${chainId}. Production v1.4 needs an explicit pauser (usually the Safe).`,
    );
  }
  return pauser;
}

/** Canonical route identifiers shared by contract, SDK, and backend. */
export function routeIdsV14(): { agent: string; merchant: string } {
  return {
    agent: keccak256(toUtf8Bytes("agent-x402")),
    merchant: keccak256(toUtf8Bytes("merchant-aifp1")),
  };
}

export interface V14RouteDeploymentConfig {
  routeIds: string[];
  treasuryBps: number[];
  ipCreatorBps: number[];
}

/** Ordered constructor arguments for v1.4 route configuration.
 *  Agent route is fee-free; merchant route carries the platform treasury fee.
 *  IP creator fees are currently unused.
 */
export function routeDeploymentConfigV14(): V14RouteDeploymentConfig {
  const { agent, merchant } = routeIdsV14();
  return {
    routeIds: [agent, merchant],
    treasuryBps: [0, 100],
    ipCreatorBps: [0, 0],
  };
}
