import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import hre, { network } from "hardhat";
import { verifyContract } from "@nomicfoundation/hardhat-verify/verify";
import type { VerifyContractArgs } from "@nomicfoundation/hardhat-verify/verify";
import type { DeploymentRecord } from "./lib/types.js";

const { ethers, networkName } = await network.create();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findDeploymentRecords(network: string): DeploymentRecord[] {
    const deploymentsDir = path.join(__dirname, "../deployments");
    if (!fs.existsSync(deploymentsDir)) {
        return [];
    }

    const records: DeploymentRecord[] = [];
    const candidates = [
        `${network}-latest.json`,
        `${network}-v14-latest.json`,
        `${network}-v14-production-latest.json`,
    ];
    for (const file of candidates) {
        const p = path.join(deploymentsDir, file);
        if (fs.existsSync(p)) {
            records.push(JSON.parse(fs.readFileSync(p, "utf8")) as DeploymentRecord);
        }
    }
    return records;
}

function readDeployment(network: string): DeploymentRecord {
    const records = findDeploymentRecords(network);
    if (records.length === 0) {
        throw new Error(
            `No deployment record found for network "${network}". Run deploy or create the file first.`
        );
    }
    // Prefer the newest v1.4 record if available, otherwise fall back to latest.
    const v14 = records.find((r) => r.splitterVersion === "1.4" || r.splitterV14);
    return v14 ?? records[0];
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

async function verifySplitterV13(record: DeploymentRecord): Promise<void> {
    const splitter = record.splitter;
    if (!splitter) {
        console.log("No v1.3 splitter deployment found; skipping.");
        return;
    }

    const { address, owner, treasury, usdc, usdt } = splitter;
    await verifyOne(
        {
            address,
            constructorArgs: [owner, treasury, [usdc, usdt], 0, 0],
            contract: "contracts/B2BSplitterV13.sol:B2BSplitterV13",
        },
        "B2BSplitterV13"
    );
}

async function verifySplitterV14(record: DeploymentRecord): Promise<void> {
    const v14 = record.splitterV14 ?? (record.splitterVersion === "1.4" ? record.splitter as any : undefined);
    if (!v14) {
        console.log("No v1.4 splitter deployment found; skipping.");
        return;
    }

    const { address, admin, signer, pauser, treasury, usdc, usdt } = v14;

    // v1.4 constructor is a struct: ConstructorParams
    const constructorArgs = [
        {
            initialAdmin: admin,
            initialSigner: signer,
            initialPauser: pauser,
            treasury,
            stablecoins: [usdc, usdt].filter((t) => t !== ethers.ZeroAddress),
            routeIds: [routeId("agent-x402"), routeId("merchant-aifp1")],
            treasuryBps: [0, 100],
            ipCreatorBps: [0, 0],
        },
    ];

    await verifyOne(
        {
            address,
            constructorArgs,
            contract: "contracts/B2BSplitterV14.sol:B2BSplitterV14",
        },
        "B2BSplitterV14"
    );
}

function routeId(name: string): string {
    return ethers.keccak256(ethers.toUtf8Bytes(name));
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

    await verifySplitterV13(record);
    await verifySplitterV14(record);

    console.log("\n=== VERIFICATION COMPLETE ===");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
