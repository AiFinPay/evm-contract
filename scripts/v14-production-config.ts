// Production deployment configuration for B2BSplitter v1.4 across AiFinPay
// EVM networks. Stablecoin defaults are conservative: a non-zero default is
// present only where the issuer's current documentation was verified during
// the v1.4 production-RC review. Overrides require ALLOW_STABLE_OVERRIDE=true.

export type V14ProductionNetwork = {
    name: string;
    chainId: number;
    usdc: string;
    usdt: string;
    usdcSource: string | null;
    usdtSource: string | null;
};

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const CIRCLE_USDC_SOURCE = "Circle USDC contract-address registry, verified 2026-08-27";
const TETHER_USDT_SOURCE = "Tether supported-protocols registry, verified 2026-08-27";

export const V14_PRODUCTION_NETWORKS: Record<number, V14ProductionNetwork> = {
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
    const network = V14_PRODUCTION_NETWORKS[chainId];
    if (!network) throw new Error(`Unsupported AiFinPay v1.4 chainId ${chainId}`);
    const canonical = symbol === "USDC" ? network.usdc : network.usdt;
    const override = process.env[`STABLE_${symbol}_${chainId}`]?.trim();
    if (!override) return canonical;
    if (process.env.ALLOW_STABLE_OVERRIDE !== "true") {
        throw new Error(
            `${symbol} override supplied for chain ${chainId} but ALLOW_STABLE_OVERRIDE is not true. ` +
                `An override must be independently verified and explicitly approved.`
        );
    }
    return override;
}

export function governanceEnv(chainId: number): { admin: string; treasury: string } {
    const admin = process.env[`AIFINPAY_SAFE_${chainId}`]?.trim();
    const treasury = process.env[`AIFINPAY_TREASURY_${chainId}`]?.trim() || admin;
    if (!admin || !treasury) {
        throw new Error(
            `Missing AIFINPAY_SAFE_${chainId}/AIFINPAY_TREASURY_${chainId}. ` +
                `Production v1.4 deployment never falls back to a deployer EOA.`
        );
    }
    return { admin, treasury };
}

export function initialSignerEnv(): string {
    const signer = process.env.AIFINPAY_V14_SIGNER?.trim();
    if (!signer) {
        throw new Error(
            "AIFINPAY_V14_SIGNER is required — the backend KMS-backed public key that will hold SIGN_OPERATOR_ROLE."
        );
    }
    return signer;
}

/** Canonical route identifiers shared by contract, SDK, and backend. */
export function routeIdsV14(): { agent: string; merchant: string } {
    const { ethers } = await import("ethers");
    return {
        agent: ethers.keccak256(ethers.toUtf8Bytes("agent-x402")),
        merchant: ethers.keccak256(ethers.toUtf8Bytes("merchant-aifp1")),
    };
}
