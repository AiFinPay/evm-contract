import { network } from "hardhat";
import { DeploymentRecord } from "./lib/types.js";
import { computeRuntimeCodeHash, getDeployerInfo, writeDeploymentRecord } from "./lib/deployment.js";
import {
    V14_PRODUCTION_NETWORKS,
    configuredStableAddress,
    governanceEnv,
    initialSignerEnv,
    routeIdsV14,
} from "./v14-production-config.js";

const { ethers, networkName } = await network.create();

/**
 * Deploys B2BSplitter v1.4 to production networks using explicit governance env.
 * This script is the strict counterpart to deploy-splitter-v14.ts: it never
 * falls back to the deployer EOA and aborts if any required env is missing.
 */
const ZERO = ethers.ZeroAddress;

async function main() {
    const { chainId } = await getDeployerInfo(ethers, networkName);
    const networkCfg = V14_PRODUCTION_NETWORKS[chainId];
    if (!networkCfg) throw new Error(`No v1.4 production config for chainId ${chainId}.`);

    const gov = governanceEnv(chainId);
    const signer = initialSignerEnv();

    if (gov.admin === ZERO) throw new Error("Admin cannot be address(0).");
    if (signer === ZERO) throw new Error("Signer cannot be address(0).");
    if (gov.admin.toLowerCase() === signer.toLowerCase()) {
        throw new Error("ADMIN and SIGNER must be different addresses.");
    }

    const { agent, merchant } = await routeIdsV14();
    const usdc = configuredStableAddress(chainId, "USDC");
    const usdt = configuredStableAddress(chainId, "USDT");
    const stablecoins = [usdc, usdt].filter((t) => t !== ZERO);

    const Factory = await ethers.getContractFactory("B2BSplitterV14");
    const splitter = await Factory.deploy({
        initialAdmin: gov.admin,
        initialSigner: signer,
        treasury: gov.treasury,
        stablecoins,
        routeIds: [agent, merchant],
        treasuryBps: [0, 100],
        ipCreatorBps: [0, 0],
    });

    await splitter.waitForDeployment();
    const addr = await splitter.getAddress();
    const runtimeCodeHash = await computeRuntimeCodeHash(ethers, addr);

    const tokenListAddr = await splitter.tokenList();
    const profilesAddr = await splitter.profiles();

    const record: Omit<DeploymentRecord, "network" | "chainId" | "timestamp"> & Record<string, unknown> = {
        network: networkName,
        chainId,
        splitterVersion: "1.4",
        splitter: {
            address: addr,
            admin: gov.admin,
            signer,
            treasury: gov.treasury,
            tokenList: tokenListAddr,
            profiles: profilesAddr,
            usdc,
            usdt,
        },
        runtimeCodeHash,
    };

    writeDeploymentRecord(networkName, chainId, record, "v14-production-latest");

    console.log(`\n✅ B2BSplitterV14 production deployed: ${addr}`);
    console.log(`   tokenList  = ${tokenListAddr}`);
    console.log(`   profiles   = ${profilesAddr}`);
    console.log(`   runtimeCodeHash = ${runtimeCodeHash}`);
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
