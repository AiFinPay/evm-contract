import { defineConfig, configVariable } from "hardhat/config";
import * as dotenv from "dotenv";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import hardhatLedgerPlugin from "@nomicfoundation/hardhat-ledger";
import hardhatKeystore from "@nomicfoundation/hardhat-keystore";

dotenv.config();

const LEDGER_ACCOUNT = process.env.LEDGER_ACCOUNT ? [process.env.LEDGER_ACCOUNT] : [];

const DEV_KEY = process.env.DEV_DEPLOYER_KEY ? [process.env.DEV_DEPLOYER_KEY] : [];
const PROD_KEY = process.env.PROD_DEPLOYER_KEY ? [process.env.PROD_DEPLOYER_KEY] : [];

function prodAccount(variableName: string): (string | ReturnType<typeof configVariable>)[] {
  return PROD_KEY.length ? PROD_KEY : [configVariable(variableName)];
}

/**
 * Returns accounts/ledgerAccounts for production networks.
 * Priority:
 * 1. PROD_DEPLOYER_KEY (global private key for all mainnets).
 * 2. LEDGER_ACCOUNT env (Ledger hardware wallet).
 * 3. Network-specific *_DEPLOYER_KEY config variable as last resort.
 */
function prodAccounts(networkKey: string): { accounts: string[]; ledgerAccounts?: string[] } {
  if (PROD_KEY.length) return { accounts: PROD_KEY };
  if (LEDGER_ACCOUNT.length) return { accounts: [], ledgerAccounts: LEDGER_ACCOUNT };
  return { accounts: [configVariable(`${networkKey}_DEPLOYER_KEY`)] as unknown as string[] };
}

export default defineConfig({
  plugins: [hardhatToolboxMochaEthers, hardhatLedgerPlugin, hardhatKeystore],

  solidity: {
    profiles: {
      default: {
        version: "0.8.35",
        settings: {
          optimizer: { enabled: true, runs: 10000 },
          viaIR: true,
          evmVersion: "cancun",
        },
      },
      production: {
        version: "0.8.35",
        settings: {
          optimizer: { enabled: true, runs: 10000 },
          viaIR: true,
          evmVersion: "cancun",
        },
      },
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
      chainId: 137,
      chainType: "l1",
      ...prodAccounts("POLYGON"),
    },
    avalanche: {
      type: "http",
      url: process.env.AVALANCHE_MAINNET_RPC || "https://api.avax.network/ext/bc/C/rpc",
      chainId: 43114,
      chainType: "l1",
      ...prodAccounts("AVALANCHE"),
    },
    arbitrum: {
      type: "http",
      url: process.env.ARBITRUM_MAINNET_RPC || "https://arb1.arbitrum.io/rpc",
      chainId: 42161,
      chainType: "l1",
      ...prodAccounts("ARBITRUM"),
    },
    bnb: {
      type: "http",
      url: process.env.BNB_MAINNET_RPC || "https://bsc-dataseed.binance.org",
      chainId: 56,
      chainType: "l1",
      ...prodAccounts("BNB"),
    },
    base: {
      type: "http",
      url: process.env.BASE_MAINNET_RPC || "https://mainnet.base.org",
      chainId: 8453,
      chainType: "op",
      ...prodAccounts("BASE"),
    },
    unichain: {
      type: "http",
      url: process.env.UNICHAIN_RPC || "https://mainnet.unichain.org",
      chainId: 130,
      chainType: "op",
      ...prodAccounts("UNICHAIN"),
    },
    optimism: {
      type: "http",
      url: process.env.OPTIMISM_RPC || "https://mainnet.optimism.io",
      chainId: 10,
      chainType: "op",
      ...prodAccounts("OPTIMISM"),
    },
    botchain: {
      type: "http",
      url: process.env.BOTCHAIN_RPC || "https://rpc.botchain.ai",
      chainId: 677,
      chainType: "l1",
      ...prodAccounts("BOTCHAIN"),
    },
    xrplevm: {
      type: "http",
      url: process.env.XRPLEVM_RPC || "https://rpc.xrplevm.org",
      chainId: 1440000,
      chainType: "l1",
      ...prodAccounts("XRPLEVM"),
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
          apiUrl: "https://api.etherscan.io/v2/api",
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
          apiUrl: "https://api.etherscan.io/v2/api",
        },
      },
    },
    43114: {
      name: "Avalanche C-Chain",
      chainType: "l1",
      blockExplorers: {
        etherscan: {
          name: "Snowtrace",
          url: "https://snowscan.xyz",
          apiUrl: "https://api.etherscan.io/v2/api",
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
          apiUrl: "https://api.etherscan.io/v2/api",
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
          apiUrl: "https://api.etherscan.io/v2/api",
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
          apiUrl: "https://api.etherscan.io/v2/api",
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
          apiUrl: "https://api.etherscan.io/v2/api",
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
          apiUrl: "https://api.etherscan.io/v2/api",
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
          apiUrl: "https://explorer.botchain.ai/api",
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
          apiUrl: "https://explorer.xrplevm.org/api",
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
