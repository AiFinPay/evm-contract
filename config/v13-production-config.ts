// Production deployment configuration for AiFinPay's nine EVM networks.
//
// IMPORTANT: stablecoin defaults are deliberately conservative. A non-zero
// default is present only where the issuer's current documentation was
// verified during the 2026-08-16 production-RC review. Other assets require an
// explicit STABLE_USDC_<chainId>/STABLE_USDT_<chainId> environment override
// plus ALLOW_STABLE_OVERRIDE=true. That prevents a stale bridged/tokenlist
// address from silently becoming a settlement asset.

import { ethers } from "ethers";

export type ProductionEvmNetwork = {
  name: string;
  chainId: number;
  usdc: string;
  usdt: string;
  usdcSource: string | null;
  usdtSource: string | null;
};

export const ZERO_ADDRESS = ethers.ZeroAddress;

const CIRCLE_USDC_SOURCE = "Circle USDC contract-address registry, verified 2026-08-16";
const TETHER_USDT_SOURCE = "Tether supported-protocols registry, verified 2026-08-16";

export const TESTNET_EVM_NETWORKS: Record<number, ProductionEvmNetwork> = {
  80002: {
    name: "Polygon Amoy",
    chainId: 80002,
    usdc: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
    usdt: "0x9281E8AF71Dd83c2484a8a22a1b820aEA21ebB32",
    usdcSource: "Circle Amoy USDC faucet contract",
    usdtSource: "AiFinPay mintable mock USDT on Amoy",
  },
};

export const PRODUCTION_EVM_NETWORKS: Record<number, ProductionEvmNetwork> = {
  137: {
    name: "Polygon PoS",
    chainId: 137,
    usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    usdt: ZERO_ADDRESS,
    usdcSource: CIRCLE_USDC_SOURCE,
    usdtSource: null,
  },
  43114: {
    name: "Avalanche C-Chain",
    chainId: 43114,
    usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    usdt: "0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7",
    usdcSource: CIRCLE_USDC_SOURCE,
    usdtSource: TETHER_USDT_SOURCE,
  },
  42161: {
    name: "Arbitrum One",
    chainId: 42161,
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    usdt: ZERO_ADDRESS,
    usdcSource: CIRCLE_USDC_SOURCE,
    usdtSource: null,
  },
  56: {
    name: "BNB Chain",
    chainId: 56,
    usdc: ZERO_ADDRESS,
    usdt: ZERO_ADDRESS,
    usdcSource: null,
    usdtSource: null,
  },
  8453: {
    name: "Base",
    chainId: 8453,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    usdt: ZERO_ADDRESS,
    usdcSource: CIRCLE_USDC_SOURCE,
    usdtSource: null,
  },
  130: {
    name: "Unichain",
    chainId: 130,
    usdc: "0x078D782b760474a361dDA0AF3839290b0EF57AD6",
    usdt: ZERO_ADDRESS,
    usdcSource: CIRCLE_USDC_SOURCE,
    usdtSource: null,
  },
  10: {
    name: "OP Mainnet",
    chainId: 10,
    usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    usdt: ZERO_ADDRESS,
    usdcSource: CIRCLE_USDC_SOURCE,
    usdtSource: null,
  },
  677: {
    name: "BOT Chain",
    chainId: 677,
    usdc: ZERO_ADDRESS,
    usdt: ZERO_ADDRESS,
    usdcSource: null,
    usdtSource: null,
  },
  1440000: {
    name: "XRPL EVM",
    chainId: 1440000,
    usdc: ZERO_ADDRESS,
    usdt: ZERO_ADDRESS,
    usdcSource: null,
    usdtSource: null,
  },
};

export function configuredStableAddress(chainId: number, symbol: "USDC" | "USDT"): string {
  const network = PRODUCTION_EVM_NETWORKS[chainId] || TESTNET_EVM_NETWORKS[chainId];
  if (!network) throw new Error(`Unsupported AiFinPay EVM chainId ${chainId}`);
  const canonical = symbol === "USDC" ? network.usdc : network.usdt;
  const override = process.env[`STABLE_${symbol}_${chainId}`]?.trim();
  if (!override) return canonical;
  if (process.env.ALLOW_STABLE_OVERRIDE !== "true") {
    throw new Error(
      `${symbol} override supplied for chain ${chainId} but ALLOW_STABLE_OVERRIDE is not true. ` +
      `An override must be independently verified and explicitly approved.`,
    );
  }
  return override;
}

export function governanceEnv(chainId: number): { owner: string; treasury: string } {
  const owner = process.env[`AIFINPAY_SAFE_${chainId}`]?.trim();
  const treasury = process.env[`AIFINPAY_TREASURY_${chainId}`]?.trim() || owner;
  if (!owner || !treasury) {
    throw new Error(
      `Missing AIFINPAY_SAFE_${chainId}/AIFINPAY_TREASURY_${chainId}. ` +
      `Production v1.3 deployment never falls back to a deployer EOA.`,
    );
  }
  return { owner, treasury };
}
