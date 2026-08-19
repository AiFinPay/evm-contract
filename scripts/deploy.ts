import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";
import { DeploymentRecord } from "./lib/types.js";
import { getDeployerInfo, writeDeploymentRecord } from "./lib/deployment.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { ethers, networkName } = await network.create();

async function main() {
  const { address: deployer, chainId } = await getDeployerInfo(
    ethers,
    networkName
  );

  // Load chain config
  const configPath = path.join(
    __dirname,
    `../config/chains/${networkName}.json`
  );
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `No config found for network "${networkName}". Create config/chains/${networkName}.json first.`
    );
  }
  const chainConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));

  if (chainConfig.treasury === "DEPLOY_GNOSIS_SAFE_FIRST") {
    throw new Error(
      `Treasury not set for ${networkName}. Deploy a Gnosis Safe on this chain first and update config/chains/${networkName}.json`
    );
  }

  const { pyth, usdc, usdt, nativeUsdId, treasury } = chainConfig;

  console.log(`\nChain config loaded:`);
  console.log(`  Pyth:         ${pyth}`);
  console.log(`  USDC:         ${usdc}`);
  console.log(`  USDT:         ${usdt}`);
  console.log(`  NativeUsdId:  ${nativeUsdId}`);
  console.log(`  Treasury:     ${treasury}`);

  // 1. Deploy mSECCO token
  console.log("\n1. Deploying MSECCOToken...");
  const MSECCOToken = await ethers.getContractFactory("MSECCOToken");
  const msecco = await MSECCOToken.deploy(deployer);
  await msecco.waitForDeployment();
  const mseccoAddr = await msecco.getAddress();
  console.log("   MSECCOToken:", mseccoAddr);

  // 2. Deploy AgentPassport
  console.log("2. Deploying AgentPassport...");
  const AgentPassport = await ethers.getContractFactory("AgentPassport");
  const passport = await AgentPassport.deploy(deployer);
  await passport.waitForDeployment();
  const passportAddr = await passport.getAddress();
  console.log("   AgentPassport:", passportAddr);

  // 3. Deploy AiFinPayCore
  console.log("3. Deploying AiFinPayCore...");
  const AiFinPayCore = await ethers.getContractFactory("AiFinPayCore");
  const core = await AiFinPayCore.deploy(
    deployer,
    mseccoAddr,
    passportAddr,
    treasury,
    pyth,
    [usdc, usdt],
    nativeUsdId
  );
  await core.waitForDeployment();
  const coreAddr = await core.getAddress();
  console.log("   AiFinPayCore:", coreAddr);

  // 4. Wire up permissions
  console.log("4. Wiring permissions...");
  await msecco.setCore(coreAddr);
  await passport.setCore(coreAddr);
  console.log("   Done.");

  const { timestamped } = writeDeploymentRecord(
    networkName,
    chainId,
    {
      core: {
        msecco: mseccoAddr,
        passport: passportAddr,
        core: coreAddr,
        owner: deployer,
      },
    } as DeploymentRecord,
    "latest"
  );

  console.log(`\nDeployment record written: ${timestamped}`);
  console.log("\n=== DEPLOYMENT COMPLETE ===");
  console.log(`Network:       ${networkName}`);
  console.log(`MSECCOToken:   ${mseccoAddr}`);
  console.log(`AgentPassport: ${passportAddr}`);
  console.log(`AiFinPayCore:  ${coreAddr}`);
  console.log(`Treasury:      ${treasury}`);

  console.log("\n--- Verify commands ---");
  console.log(`bun run verify --network ${networkName}`);

  console.log("\n--- Next steps ---");
  console.log("1. Run bun run verify --network <network> to source-verify contracts");
  console.log("2. Transfer ownership to Gnosis Safe: core.transferOwnership(<safe_address>)");
  console.log("3. Update CLAUDE.md with new contract addresses");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
