import { fileURLToPath } from "node:url";
import * as fs from "fs";
import * as path from "path";
import { network } from "hardhat";
import { DeploymentRecord } from "./types.js";

const { ethers, networkName } = await network.create();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = (await ethers.provider.getNetwork()).chainId;

  console.log(`Deploying to: ${networkName} (chainId ${chainId})`);
  console.log("Deployer:", deployer.address);
  console.log(
    "Balance:",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
    "native"
  );

  // Load chain config
  const configPath = path.join(__dirname, `../config/chains/${networkName}.json`);
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
  const msecco = await MSECCOToken.deploy(deployer.address);
  await msecco.waitForDeployment();
  console.log("   MSECCOToken:", await msecco.getAddress());

  // 2. Deploy AgentPassport
  console.log("2. Deploying AgentPassport...");
  const AgentPassport = await ethers.getContractFactory("AgentPassport");
  const passport = await AgentPassport.deploy(deployer.address);
  await passport.waitForDeployment();
  console.log("   AgentPassport:", await passport.getAddress());

  // 3. Deploy AiFinPayCore
  console.log("3. Deploying AiFinPayCore...");
  const AiFinPayCore = await ethers.getContractFactory("AiFinPayCore");
  const core = await AiFinPayCore.deploy(
    deployer.address,
    await msecco.getAddress(),
    await passport.getAddress(),
    treasury,
    pyth,
    [usdc, usdt],
    nativeUsdId
  );
  await core.waitForDeployment();
  console.log("   AiFinPayCore:", await core.getAddress());

  // 4. Wire up permissions
  console.log("4. Wiring permissions...");
  await msecco.setCore(await core.getAddress());
  await passport.setCore(await core.getAddress());
  console.log("   Done.");

  const mseccoAddr = await msecco.getAddress();
  const passportAddr = await passport.getAddress();
  const coreAddr = await core.getAddress();

  const timestamp = new Date().toISOString();
  const deploymentRecord = {
    network: networkName,
    chainId: Number(chainId),
    timestamp,
    core: {
      msecco: mseccoAddr,
      passport: passportAddr,
      core: coreAddr,
      owner: deployer.address,
    },
  } as DeploymentRecord;

  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  const recordFileName = `${networkName}-${timestamp.replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(
    path.join(deploymentsDir, recordFileName),
    JSON.stringify(deploymentRecord, null, 2) + "\n"
  );
  fs.writeFileSync(
    path.join(deploymentsDir, `${networkName}-latest.json`),
    JSON.stringify(deploymentRecord, null, 2) + "\n"
  );

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
