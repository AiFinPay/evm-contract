import "@nomicfoundation/hardhat-toolbox";
import { HardhatUserConfig } from "hardhat/config";
import * as dotenv from "dotenv";

dotenv.config();

const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.35",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      evmVersion: "cancun",
    },
  },
  networks: {
    // ── Polygon ───────────────────────────────────────────────────────────────
    amoy: {
      url: "https://rpc-amoy.polygon.technology",
      accounts: DEPLOYER_KEY,
      chainId: 80002,
    },
    polygon: {
      url: process.env.POLYGON_MAINNET_RPC || "https://polygon-bor-rpc.publicnode.com",
      accounts: DEPLOYER_KEY,
      chainId: 137,
    },
    // ── Base ─────────────────────────────────────────────────────────────────
    "base-sepolia": {
      url: process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org",
      accounts: DEPLOYER_KEY,
      chainId: 84532,
    },
    base: {
      url: process.env.BASE_MAINNET_RPC || "https://mainnet.base.org",
      accounts: DEPLOYER_KEY,
      chainId: 8453,
    },
    // ── Arbitrum ─────────────────────────────────────────────────────────────
    "arbitrum-sepolia": {
      url: process.env.ARBITRUM_SEPOLIA_RPC || "https://sepolia-rollup.arbitrum.io/rpc",
      accounts: DEPLOYER_KEY,
      chainId: 421614,
    },
    arbitrum: {
      url: process.env.ARBITRUM_MAINNET_RPC || "https://arb1.arbitrum.io/rpc",
      accounts: DEPLOYER_KEY,
      chainId: 42161,
    },
    // ── BNB Chain ─────────────────────────────────────────────────────────────
    "bnb-testnet": {
      url: process.env.BNB_TESTNET_RPC || "https://data-seed-prebsc-1-s1.binance.org:8545",
      accounts: DEPLOYER_KEY,
      chainId: 97,
    },
    bnb: {
      url: process.env.BNB_MAINNET_RPC || "https://bsc-dataseed.binance.org",
      accounts: DEPLOYER_KEY,
      chainId: 56,
    },
    // ── Ethereum ──────────────────────────────────────────────────────────────
    ethereum: {
      url: process.env.ETHEREUM_MAINNET_RPC || "https://eth.llamarpc.com",
      accounts: DEPLOYER_KEY,
      chainId: 1,
    },
    // ── Avalanche ─────────────────────────────────────────────────────────────
    avalanche: {
      url: process.env.AVALANCHE_MAINNET_RPC || "https://api.avax.network/ext/bc/C/rpc",
      accounts: DEPLOYER_KEY,
      chainId: 43114,
    },
    // ── Astar Network ─────────────────────────────────────────────────────────
    astar: {
      url: process.env.ASTAR_MAINNET_RPC || "https://evm.astar.network",
      accounts: DEPLOYER_KEY,
      chainId: 592,
    },
    // ── Hyperliquid HyperEVM ───────────────────────────────────────────────────
    hyperliquid: {
      url: process.env.HYPERLIQUID_RPC || "https://rpc.hyperliquid.xyz/evm",
      accounts: DEPLOYER_KEY,
      chainId: 999,
    },
    // ── 8-chain rollout batch (added Jun 2026) ──────────────────────────────
    optimism: {
      url: process.env.OPTIMISM_RPC || "https://mainnet.optimism.io",
      accounts: DEPLOYER_KEY,
      chainId: 10,
    },
    xrplevm: {
      url: process.env.XRPLEVM_RPC || "https://rpc.xrplevm.org",
      accounts: DEPLOYER_KEY,
      chainId: 1440000,
    },
    botchain: {
      url: process.env.BOTCHAIN_RPC || "https://rpc.botchain.ai",
      accounts: DEPLOYER_KEY,
      chainId: 677,
    },
    hedera: {
      url: process.env.HEDERA_RPC || "https://mainnet.hashio.io/api",
      accounts: DEPLOYER_KEY,
      chainId: 295,
    },
    kaia: {
      url: process.env.KAIA_RPC || "https://public-en.node.kaia.io",
      accounts: DEPLOYER_KEY,
      chainId: 8217,
    },
    somnia: {
      url: process.env.SOMNIA_RPC || "https://api.infra.mainnet.somnia.network",
      accounts: DEPLOYER_KEY,
      chainId: 5031,
    },
    unichain: {
      url: process.env.UNICHAIN_RPC || "https://mainnet.unichain.org",
      accounts: DEPLOYER_KEY,
      chainId: 130,
    },
  },
  etherscan: {
    // Etherscan v2 unified API — one key for all supported chains (v1 per-chain keys are EOL)
    apiKey: { avalanche: "verifyContract", polygon: process.env.POLYGONSCAN_API_KEY || "" } as any,
    customChains: [
      {
        network: "polygonAmoy",
        chainId: 80002,
        urls: {
          apiURL: "https://api-amoy.polygonscan.com/api",
          browserURL: "https://amoy.polygonscan.com",
        },
      },
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org",
        },
      },
      {
        network: "base-sepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org",
        },
      },
      {
        network: "arbitrum-sepolia",
        chainId: 421614,
        urls: {
          apiURL: "https://api-sepolia.arbiscan.io/api",
          browserURL: "https://sepolia.arbiscan.io",
        },
      },
      {
        network: "avalanche",
        chainId: 43114,
        urls: {
          apiURL: "https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan",
          browserURL: "https://snowtrace.io",
        },
      },
      {
        network: "astar",
        chainId: 592,
        urls: {
          apiURL: "https://blockscout.com/astar/api",
          browserURL: "https://blockscout.com/astar",
        },
      },
      {
        network: "hyperliquid",
        chainId: 999,
        urls: {
          apiURL: "https://explorer.hyperliquid.xyz/api",
          browserURL: "https://explorer.hyperliquid.xyz",
        },
      },
    ],
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
