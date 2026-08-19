import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import hre, { network } from "hardhat";
import { verifyContract } from "@nomicfoundation/hardhat-verify/verify";
import type { VerifyContractArgs } from "@nomicfoundation/hardhat-verify/verify";
import type { DeploymentRecord } from "./lib/types.js";

const { ethers, networkName } = await network.create();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findLatestDeploymentRecord(network: string): DeploymentRecord | null {
    const deploymentsDir = path.join(__dirname, "../deployments");
    if (!fs.existsSync(deploymentsDir)) {
        return null;
    }

    const latestRecordPath = path.join(deploymentsDir, `${network}-latest.json`);
    if (fs.existsSync(latestRecordPath)) {
        return JSON.parse(fs.readFileSync(latestRecordPath, "utf8")) as DeploymentRecord;
    }

    return null;
}

function readDeployment(network: string): DeploymentRecord {
    const record = findLatestDeploymentRecord(network);
    if (record === null) {
        throw new Error(
            `No deployment record found for network "${network}". Run deploy or create the file first.`
        );
    }
    return record;
}

async function verifyOne(args: VerifyContractArgs, label: string): Promise<void> {
    console.log(`\nVerifying ${label} at ${args.address}...`);
    try {
        await verifyContract(args, hre);
        console.log(`✅ ${label} verified.`);
    } catch (error: any) {
        if (error?.message?.includes("already been verified")) {
            console.log(`ℹ️  ${label} already verified.`);
        } else {
            console.error(`❌ ${label} verification failed:`, error?.message ?? error);
            throw error;
        }
    }
}

async function verifyCore(record: DeploymentRecord): Promise<void> {
    if (!record.core) {
        console.log("No core deployment found; skipping core verification.");
        return;
    }

    const { msecco, passport, core, owner } = record.core;

    await verifyOne(
        {
            address: msecco,
            constructorArgs: [owner],
            contract: "contracts/MSECCOToken.sol:MSECCOToken",
        },
        "MSECCOToken"
    );

    await verifyOne(
        {
            address: passport,
            constructorArgs: [owner],
            contract: "contracts/AgentPassport.sol:AgentPassport",
        },
        "AgentPassport"
    );

    const configPath = path.join(__dirname, `../config/chains/${networkName}.json`);
    if (!fs.existsSync(configPath)) {
        throw new Error(`No chain config found for network "${networkName}".`);
    }
    const chainConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const { pyth, usdc, usdt, nativeUsdId, treasury } = chainConfig;

    await verifyOne(
        {
            address: core,
            constructorArgs: [owner, msecco, passport, treasury, pyth, usdc, usdt, nativeUsdId],
            contract: "contracts/AiFinPayCore.sol:AiFinPayCore",
        },
        "AiFinPayCore"
    );
}

async function verifySplitter(record: DeploymentRecord): Promise<void> {
    if (!record.splitter) {
        console.log("No splitter deployment found; skipping splitter verification.");
        return;
    }

    const { address, owner, treasury, usdc, usdt } = record.splitter;

    await verifyOne(
        {
            address,
            constructorArgs: [owner, treasury, usdc, usdt],
            contract: "contracts/B2BSplitter.sol:B2BSplitter",
        },
        "B2BSplitter"
    );
}

async function main() {
    const chainId = Number((await ethers.provider.getNetwork()).chainId);
    console.log(`Verifying on ${networkName} (chainId ${chainId})`);

    const record = readDeployment(networkName);
    if (record.chainId !== chainId) {
        throw new Error(
            `Deployment record chainId (${record.chainId}) does not match current network (${chainId}).`
        );
    }

    await verifyCore(record);
    await verifySplitter(record);

    console.log("\n=== VERIFICATION COMPLETE ===");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
