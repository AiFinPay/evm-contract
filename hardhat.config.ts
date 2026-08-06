import { defineConfig } from "hardhat/config";
import * as dotenv from "dotenv";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";

dotenv.config();

const DEV_KEY = process.env.DEV_DEPLOYER_KEY ? [process.env.DEV_DEPLOYER_KEY] : [];
const PROD_KEY = process.env.PROD_DEPLOYER_KEY ? [process.env.PROD_DEPLOYER_KEY] : [];

const EXPLORER_KEY =
  process.env.ETHERSCAN_API_KEY || process.env.POLYGONSCAN_API_KEY || "";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthers],

  solidity: {
    version: "0.8.35",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      evmVersion: "cancun",
    },
  },

  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },

  typechain: {
    outDir: "typechain-types",
  },

  networks: {
    // In-process simulated network (default for tests/node)
    default: {
      type: "edr-simulated",
      chainType: "generic",
      mining: {
        auto: true,
        interval: 1000, // optional block time in ms
      },
    },
    // Standard connection for `npx hardhat node`
    localhost: {
      type: "http",
      url: "http://127.0.0.1:8545",
    },
    amoy: {
      type: "http",
      url: "https://rpc-amoy.polygon.technology",
      accounts: DEV_KEY,
      chainId: 80002,
      chainType: "l1",
    },
    polygon: {
      type: "http",
      url: process.env.POLYGON_MAINNET_RPC || "https://polygon-bor-rpc.publicnode.com",
      accounts: PROD_KEY,
      chainId: 137,
      chainType: "l1",
    },
    "base-sepolia": {
      type: "http",
      url: process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org",
      accounts: DEV_KEY,
      chainId: 84532,
      chainType: "op",
    },
    base: {
      type: "http",
      url: process.env.BASE_MAINNET_RPC || "https://mainnet.base.org",
      accounts: PROD_KEY,
      chainId: 8453,
      chainType: "op",
    },
    "arbitrum-sepolia": {
      type: "http",
      url: process.env.ARBITRUM_SEPOLIA_RPC || "https://sepolia-rollup.arbitrum.io/rpc",
      accounts: DEV_KEY,
      chainId: 421614,
      chainType: "l1",
    },
    arbitrum: {
      type: "http",
      url: process.env.ARBITRUM_MAINNET_RPC || "https://arb1.arbitrum.io/rpc",
      accounts: PROD_KEY,
      chainId: 42161,
      chainType: "l1",
    },
    "bnb-testnet": {
      type: "http",
      url: process.env.BNB_TESTNET_RPC || "https://data-seed-prebsc-1-s1.binance.org:8545",
      accounts: DEV_KEY,
      chainId: 97,
      chainType: "l1",
    },
    bnb: {
      type: "http",
      url: process.env.BNB_MAINNET_RPC || "https://bsc-dataseed.binance.org",
      accounts: PROD_KEY,
      chainId: 56,
      chainType: "l1",
    },
    ethereum: {
      type: "http",
      url: process.env.ETHEREUM_MAINNET_RPC || "https://eth.llamarpc.com",
      accounts: PROD_KEY,
      chainId: 1,
      chainType: "l1",
    },
    avalanche: {
      type: "http",
      url: process.env.AVALANCHE_MAINNET_RPC || "https://api.avax.network/ext/bc/C/rpc",
      accounts: PROD_KEY,
      chainId: 43114,
      chainType: "l1",
    },
    astar: {
      type: "http",
      url: process.env.ASTAR_MAINNET_RPC || "https://evm.astar.network",
      accounts: PROD_KEY,
      chainId: 592,
      chainType: "l1",
    },
    hyperliquid: {
      type: "http",
      url: process.env.HYPERLIQUID_RPC || "https://rpc.hyperliquid.xyz/evm",
      accounts: PROD_KEY,
      chainId: 999,
      chainType: "l1",
    },
    optimism: {
      type: "http",
      url: process.env.OPTIMISM_RPC || "https://mainnet.optimism.io",
      accounts: PROD_KEY,
      chainId: 10,
      chainType: "op",
    },
    xrplevm: {
      type: "http",
      url: process.env.XRPLEVM_RPC || "https://rpc.xrplevm.org",
      accounts: PROD_KEY,
      chainId: 1440000,
      chainType: "l1",
    },
    botchain: {
      type: "http",
      url: process.env.BOTCHAIN_RPC || "https://rpc.botchain.ai",
      accounts: PROD_KEY,
      chainId: 677,
      chainType: "l1",
    },
    hedera: {
      type: "http",
      url: process.env.HEDERA_RPC || "https://mainnet.hashio.io/api",
      accounts: PROD_KEY,
      chainId: 295,
      chainType: "l1",
    },
    kaia: {
      type: "http",
      url: process.env.KAIA_RPC || "https://public-en.node.kaia.io",
      accounts: PROD_KEY,
      chainId: 8217,
      chainType: "l1",
    },
    somnia: {
      type: "http",
      url: process.env.SOMNIA_RPC || "https://api.infra.mainnet.somnia.network",
      accounts: PROD_KEY,
      chainId: 5031,
      chainType: "l1",
    },
    unichain: {
      type: "http",
      url: process.env.UNICHAIN_RPC || "https://mainnet.unichain.org",
      accounts: PROD_KEY,
      chainId: 130,
      chainType: "op",
    },
  },

  chainDescriptors: {
    137: {
      name: "Polygon Mainnet",
      chainType: "l1",
      blockExplorers: {
        etherscan: {
          name: "PolygonScan",
          url: "https://polygonscan.com",
        },
      },
    },
    80002: {
      name: "Polygon Amoy",
      chainType: "l1",
      blockExplorers: {
        etherscan: {
          name: "PolygonScan Amoy",
          url: "https://amoy.polygonscan.com",
          apiUrl: "https://api-amoy.polygonscan.com/api",
        },
      },
    },
    8453: {
      name: "Base Mainnet",
      chainType: "op",
      blockExplorers: {
        etherscan: {
          name: "Basescan",
          url: "https://basescan.org",
        },
      },
    },
    84532: {
      name: "Base Sepolia",
      chainType: "op",
      blockExplorers: {
        etherscan: {
          name: "Base Sepolia Explorer",
          url: "https://sepolia.basescan.org",
        },
      },
    },
    42161: {
      name: "Arbitrum One",
      chainType: "l1",
      blockExplorers: {
        etherscan: {
          name: "Arbiscan",
          url: "https://arbiscan.io",
        },
      },
    },
    421614: {
      name: "Arbitrum Sepolia",
      chainType: "l1",
      blockExplorers: {
        etherscan: {
          name: "Arbiscan Sepolia",
          url: "https://sepolia.arbiscan.io",
        },
      },
    },
    56: {
      name: "BNB Chain",
      chainType: "l1",
      blockExplorers: {
        etherscan: {
          name: "BscScan",
          url: "https://bscscan.com",
        },
      },
    },
    97: {
      name: "BNB Testnet",
      chainType: "l1",
      blockExplorers: {
        etherscan: {
          name: "BscScan Testnet",
          url: "https://testnet.bscscan.com",
        },
      },
    },
    1: {
      name: "Ethereum Mainnet",
      chainType: "l1",
      blockExplorers: {
        etherscan: {
          name: "Etherscan",
          url: "https://etherscan.io",
        },
      },
    },
    43114: {
      name: "Avalanche C-Chain",
      chainType: "l1",
      blockExplorers: {
        etherscan: {
          name: "Snowtrace",
          url: "https://snowtrace.io",
          apiUrl: "https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan",
        },
      },
    },
    592: {
      name: "Astar Network",
      chainType: "l1",
      blockExplorers: {
        etherscan: {
          name: "Astar Blockscout",
          url: "https://blockscout.com/astar",
          apiUrl: "https://blockscout.com/astar/api",
        },
      },
    },
    999: {
      name: "Hyperliquid HyperEVM",
      chainType: "l1",
      blockExplorers: {
        etherscan: {
          name: "Hyperliquid Explorer",
          url: "https://explorer.hyperliquid.xyz",
          apiUrl: "https://explorer.hyperliquid.xyz/api",
        },
      },
    },
    10: {
      name: "Optimism Mainnet",
      chainType: "op",
      blockExplorers: {
        etherscan: {
          name: "Optimistic Etherscan",
          url: "https://optimistic.etherscan.io",
        },
      },
    },
    1440000: {
      name: "XRPL EVM",
      chainType: "l1",
      blockExplorers: {
        etherscan: {
          name: "XRPL EVM Explorer",
          url: "https://explorer.xrplevm.org",
        },
      },
    },
    677: {
      name: "BOT Chain",
      chainType: "l1",
      blockExplorers: {
        etherscan: {
          name: "BOT Chain Explorer",
          url: "https://explorer.botchain.ai",
        },
      },
    },
    295: {
      name: "Hedera Mainnet",
      chainType: "l1",
      blockExplorers: {
        etherscan: {
          name: "Hashscan",
          url: "https://hashscan.io/mainnet",
        },
      },
    },
    8217: {
      name: "Kaia Mainnet",
      chainType: "l1",
      blockExplorers: {
        etherscan: {
          name: "Kaiascan",
          url: "https://kaiascan.io",
        },
      },
    },
    5031: {
      name: "Somnia Mainnet",
      chainType: "l1",
      blockExplorers: {
        etherscan: {
          name: "Somnia Explorer",
          url: "https://explorer.somnia.network",
        },
      },
    },
    130: {
      name: "Unichain Mainnet",
      chainType: "op",
      blockExplorers: {
        etherscan: {
          name: "Unichain Explorer",
          url: "https://uniscan.xyz",
        },
      },
    },
  },

  verify: {
    etherscan: {
      apiKey: EXPLORER_KEY,
    },
    sourcify: {
      enabled: false,
    },
  },

  test: {
    mocha: {
      timeout: 40000,
    },
  },
});
