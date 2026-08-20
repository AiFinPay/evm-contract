import { defineConfig, configVariable } from "hardhat/config";
import * as dotenv from "dotenv";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import hardhatLedgerPlugin from "@nomicfoundation/hardhat-ledger";
import hardhatKeystore from "@nomicfoundation/hardhat-keystore";

dotenv.config();

const LEDGER_ACCOUNT = process.env.LEDGER_ACCOUNT ? [process.env.LEDGER_ACCOUNT] : [];

const DEV_KEY = process.env.DEV_DEPLOYER_KEY ? [process.env.DEV_DEPLOYER_KEY] : [];
const PROD_KEY = process.env.PROD_DEPLOYER_KEY ? [process.env.PROD_DEPLOYER_KEY] : [];

function prodAccount(variableName: string): string[] {
  return PROD_KEY.length ? PROD_KEY : [configVariable(variableName)];
}

const EXPLORER_KEY =
  process.env.ETHERSCAN_API_KEY || process.env.POLYGONSCAN_API_KEY || "";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthers, hardhatLedgerPlugin, hardhatKeystore],

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
    // TESTNET: Polygon Amoy only
    amoy: {
      type: "http",
      url: process.env.AMOY_RPC || "https://rpc-amoy.polygon.technology",
      accounts: DEV_KEY,
      chainId: 80002,
      chainType: "l1",
    },
    polygon: {
      type: "http",
      url: process.env.POLYGON_MAINNET_RPC || "https://polygon-bor-rpc.publicnode.com",
      accounts: prodAccount("POLYGON_DEPLOYER_KEY"),
      ledgerAccounts: PROD_KEY.length === 0 ? LEDGER_ACCOUNT : undefined,
      chainId: 137,
      chainType: "l1",
    },
    avalanche: {
      type: "http",
      url: process.env.AVALANCHE_MAINNET_RPC || "https://api.avax.network/ext/bc/C/rpc",
      accounts: prodAccount("AVALANCHE_DEPLOYER_KEY"),
      chainId: 43114,
      chainType: "l1",
    },
    arbitrum: {
      type: "http",
      url: process.env.ARBITRUM_MAINNET_RPC || "https://arb1.arbitrum.io/rpc",
      accounts: prodAccount("ARBITRUM_DEPLOYER_KEY"),
      chainId: 42161,
      chainType: "l1",
    },
    bnb: {
      type: "http",
      url: process.env.BNB_MAINNET_RPC || "https://bsc-dataseed.binance.org",
      accounts: prodAccount("BNB_DEPLOYER_KEY"),
      chainId: 56,
      chainType: "l1",
    },
    base: {
      type: "http",
      url: process.env.BASE_MAINNET_RPC || "https://mainnet.base.org",
      accounts: prodAccount("BASE_DEPLOYER_KEY"),
      chainId: 8453,
      chainType: "op",
    },
    unichain: {
      type: "http",
      url: process.env.UNICHAIN_RPC || "https://mainnet.unichain.org",
      accounts: prodAccount("UNICHAIN_DEPLOYER_KEY"),
      chainId: 130,
      chainType: "op",
    },
    optimism: {
      type: "http",
      url: process.env.OPTIMISM_RPC || "https://mainnet.optimism.io",
      accounts: prodAccount("OPTIMISM_DEPLOYER_KEY"),
      chainId: 10,
      chainType: "op",
    },
    botchain: {
      type: "http",
      url: process.env.BOTCHAIN_RPC || "https://rpc.botchain.ai",
      accounts: prodAccount("BOTCHAIN_DEPLOYER_KEY"),
      chainId: 677,
      chainType: "l1",
    },
    xrplevm: {
      type: "http",
      url: process.env.XRPLEVM_RPC || "https://rpc.xrplevm.org",
      accounts: prodAccount("XRPLEVM_DEPLOYER_KEY"),
      chainId: 1440000,
      chainType: "l1",
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
      apiKey: process.env.ETHERSCAN_API_KEY || process.env.POLYGONSCAN_API_KEY || configVariable("ETHERSCAN_API_KEY"),
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
