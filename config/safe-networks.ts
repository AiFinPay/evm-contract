/**
 * Safe Proxy Factory addresses by chain ID.
 *
 * Source: https://docs.safe.global/advanced/smart-account-supported-networks
 * Canonical addresses: https://github.com/safe-global/safe-deployments
 *
 * Each Safe contract version is deployed at its own canonical address.
 * Use these addresses to predict or deploy Safe Proxy wallets.
 *
 * @example
 *   // Predict Safe address on Polygon
 *   const factory = SAFE_CONFIG[137].proxyFactory;
 *   const singleton = SAFE_CONFIG[137].singleton;
 *   const address = predictSafeAddress(factory, singleton, owners, threshold, saltNonce);
 */

export interface SafeNetworkConfig {
  chainId: number;
  chainName: string;
  proxyFactory: string;
  singleton: string;
  safeVersion: string;
  transactionService?: string;
}

/**
 * Safe v1.5.0 canonical Singleton and Proxy Factory addresses.
 * Deployed at the same address on every chain that ships v1.5.0.
 */
export const SAFE_V150_SINGLETON = "0xFf51A5898e281Db6DfC7855790607438dF2ca44b";
export const SAFE_V150_PROXY_FACTORY = "0x14F2982D601c9458F93bd70B218933A6f8165e7b";

/**
 * Safe v1.4.1 canonical Singleton and Proxy Factory addresses.
 * Kept for chains that have not yet shipped Safe v1.5.0 (Amoy, zkEVM, etc.).
 *
 * Source: https://github.com/safe-global/safe-deployments/tree/main/src/assets/v1.4.1
 */
export const SAFE_V141_SINGLETON = "0x41675C099F32341bf84BFc5382aF534df5C7461a";
export const SAFE_V141_PROXY_FACTORY = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67";

/**
 * AiFinPay supported networks with Safe configuration.
 *
 * These are the chains where AiFinPay B2BSplitterV14 is deployed
 * and where we use Safe multisig wallets for governance.
 */
export const SAFE_CONFIG: Record<number, SafeNetworkConfig> = {
  // ─────────────────────────────────────────────────────────────
  // MAINNETS
  // ─────────────────────────────────────────────────────────────

  137: {
    chainId: 137,
    chainName: "Polygon",
    proxyFactory: SAFE_V150_PROXY_FACTORY,
    singleton: SAFE_V150_SINGLETON,
    safeVersion: "1.5.0",
    transactionService: "https://safe-transaction-polygon.safe.global",
  },

  43114: {
    chainId: 43114,
    chainName: "Avalanche",
    proxyFactory: SAFE_V150_PROXY_FACTORY,
    singleton: SAFE_V150_SINGLETON,
    safeVersion: "1.5.0",
    transactionService: "https://safe-transaction-avalanche.safe.global",
  },

  42161: {
    chainId: 42161,
    chainName: "Arbitrum",
    proxyFactory: SAFE_V150_PROXY_FACTORY,
    singleton: SAFE_V150_SINGLETON,
    safeVersion: "1.5.0",
    transactionService: "https://safe-transaction-arbitrum.safe.global",
  },

  56: {
    chainId: 56,
    chainName: "BNB Smart Chain",
    proxyFactory: SAFE_V150_PROXY_FACTORY,
    singleton: SAFE_V150_SINGLETON,
    safeVersion: "1.5.0",
    transactionService: "https://safe-transaction-bsc.safe.global",
  },

  8453: {
    chainId: 8453,
    chainName: "Base",
    proxyFactory: SAFE_V150_PROXY_FACTORY,
    singleton: SAFE_V150_SINGLETON,
    safeVersion: "1.5.0",
    transactionService: "https://safe-transaction-base.safe.global",
  },

  130: {
    chainId: 130,
    chainName: "Unichain",
    proxyFactory: SAFE_V150_PROXY_FACTORY,
    singleton: SAFE_V150_SINGLETON,
    safeVersion: "1.5.0",
    transactionService: "https://safe-transaction-unichain.safe.global",
  },

  10: {
    chainId: 10,
    chainName: "Optimism",
    proxyFactory: SAFE_V150_PROXY_FACTORY,
    singleton: SAFE_V150_SINGLETON,
    safeVersion: "1.5.0",
    transactionService: "https://safe-transaction-optimism.safe.global",
  },

  677: {
    chainId: 677,
    chainName: "BOT Chain",
    proxyFactory: SAFE_V150_PROXY_FACTORY,
    singleton: SAFE_V150_SINGLETON,
    safeVersion: "1.5.0",
    // BOT Chain may not have a Safe transaction service yet
  },

  1440000: {
    chainId: 1440000,
    chainName: "XRPL EVM",
    proxyFactory: SAFE_V150_PROXY_FACTORY,
    singleton: SAFE_V150_SINGLETON,
    safeVersion: "1.5.0",
    // XRPL EVM may not have a Safe transaction service yet
  },

  // ─────────────────────────────────────────────────────────────
  // TESTNETS
  // ─────────────────────────────────────────────────────────────

  80002: {
    chainId: 80002,
    chainName: "Polygon Amoy",
    proxyFactory: SAFE_V141_PROXY_FACTORY,
    singleton: SAFE_V141_SINGLETON,
    safeVersion: "1.4.1",
    transactionService: "https://safe-transaction-polygon-sepolia.safe.global",
  },
};

/**
 * Get Safe config for a specific chain ID.
 * @throws Error if chain is not supported
 */
export function getSafeConfig(chainId: number): SafeNetworkConfig {
  const config = SAFE_CONFIG[chainId];
  if (!config) {
    throw new Error(
      `Chain ID ${chainId} is not supported. Available chains: ${Object.keys(SAFE_CONFIG).join(", ")}`,
    );
  }
  return config;
}

/**
 * Check if a chain ID is supported by Safe.
 */
export function isSafeSupported(chainId: number): boolean {
  return chainId in SAFE_CONFIG;
}

/**
 * List all supported chain IDs.
 */
export function getSupportedChains(): number[] {
  return Object.keys(SAFE_CONFIG).map(Number);
}

/**
 * Get all Safe configs (for iteration).
 */
export function getAllSafeConfigs(): SafeNetworkConfig[] {
  return Object.values(SAFE_CONFIG);
}
