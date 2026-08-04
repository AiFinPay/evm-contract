import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { DeploymentManifest, verifyDeployment } from "./verify-deployment";

function requireAddress(label: string, value: unknown): string {
  if (typeof value !== "string" || !ethers.isAddress(value) || value === ethers.ZeroAddress) {
    throw new Error(`${label} must be a non-zero EVM address; got ${String(value)}`);
  }
  return ethers.getAddress(value);
}

async function requireContract(label: string, address: string): Promise<void> {
  if ((await ethers.provider.getCode(address)) === "0x") {
    throw new Error(`${label} ${address} has no code on ${network.name}; refusing to deploy`);
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = (await ethers.provider.getNetwork()).chainId;

  console.log(`Deploying to: ${network.name} (chainId ${chainId})`);
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "native");

  // Load chain config
  const configPath = path.join(__dirname, `../config/chains/${network.name}.json`);
  if (!fs.existsSync(configPath)) {
    throw new Error(`No config found for network "${network.name}". Create config/chains/${network.name}.json first.`);
  }
  const chainConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const deploymentDir = path.join(__dirname, "../deployments");
  const manifestPath = path.join(deploymentDir, `${network.name}.json`);
  if (fs.existsSync(manifestPath)) {
    throw new Error(`Manifest ${manifestPath} already exists; refusing to deploy without an explicit migration plan`);
  }

  if (chainConfig.chainId !== Number(chainId)) {
    throw new Error(`Config chainId ${chainConfig.chainId} does not match RPC chainId ${chainId}`);
  }

  const treasury = requireAddress("treasury", chainConfig.treasury);
  const owner = requireAddress("owner", chainConfig.owner ?? chainConfig.treasury);
  const pyth = requireAddress("pyth", chainConfig.pyth);
  const usdc = requireAddress("usdc", chainConfig.usdc);
  const usdt = requireAddress("usdt", chainConfig.usdt);
  const nativeUsdId = chainConfig.nativeUsdId;
  if (typeof nativeUsdId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(nativeUsdId) || /^0x0{64}$/.test(nativeUsdId)) {
    throw new Error(`nativeUsdId must be a non-zero bytes32 value; got ${String(nativeUsdId)}`);
  }

  await Promise.all([
    requireContract("governance owner", owner),
    requireContract("treasury", treasury),
    requireContract("Pyth", pyth),
    requireContract("USDC", usdc),
    requireContract("USDT", usdt),
  ]);
  const erc20 = ["function decimals() view returns (uint8)"];
  for (const [symbol, address] of [["USDC", usdc], ["USDT", usdt]] as const) {
    const decimals = Number(await new ethers.Contract(address, erc20, ethers.provider).decimals());
    if (decimals !== 6) {
      throw new Error(`${symbol} ${address} uses ${decimals} decimals; AiFinPayCore requires 6`);
    }
  }
  const pythReader = new ethers.Contract(
    pyth,
    ["function getPriceUnsafe(bytes32) view returns (int64 price,uint64 conf,int32 expo,uint256 publishTime)"],
    ethers.provider
  );
  const oraclePrice = await pythReader.getPriceUnsafe(nativeUsdId);
  if (oraclePrice.price <= 0n || Number(oraclePrice.expo) !== -8) {
    throw new Error(`Pyth feed ${nativeUsdId} returned price=${oraclePrice.price}, expo=${oraclePrice.expo}; expected positive/-8`);
  }

  console.log(`\nChain config loaded:`);
  console.log(`  Pyth:         ${pyth}`);
  console.log(`  USDC:         ${usdc}`);
  console.log(`  USDT:         ${usdt}`);
  console.log(`  NativeUsdId:  ${nativeUsdId}`);
  console.log(`  Treasury:     ${treasury}`);
  console.log(`  Owner:        ${owner}`);

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
    owner,
    await msecco.getAddress(),
    await passport.getAddress(),
    treasury,
    pyth,
    usdc,
    usdt,
    nativeUsdId
  );
  await core.waitForDeployment();
  console.log("   AiFinPayCore:", await core.getAddress());

  // 4. Wire up permissions
  console.log("4. Wiring permissions...");
  await (await msecco.setCore(await core.getAddress())).wait();
  await (await passport.setCore(await core.getAddress())).wait();
  console.log("5. Transferring token/passport ownership to governance...");
  await (await msecco.transferOwnership(owner)).wait();
  await (await passport.transferOwnership(owner)).wait();

  const mseccoAddr = await msecco.getAddress();
  const passportAddr = await passport.getAddress();
  const coreAddr = await core.getAddress();

  const manifest: DeploymentManifest = {
    schemaVersion: 1,
    network: network.name,
    chainId: Number(chainId),
    contracts: { msecco: mseccoAddr, passport: passportAddr, core: coreAddr },
    expected: {
      owner,
      treasury,
      pyth,
      usdc,
      usdt,
      nativeUsdId,
      paused: false,
      treasuryBps: 100,
      ipCreatorBps: 1,
    },
  };
  await verifyDeployment(ethers.provider, manifest);
  fs.mkdirSync(deploymentDir, { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });

  console.log("\n=== DEPLOYMENT COMPLETE ===");
  console.log(`Network:       ${network.name}`);
  console.log(`MSECCOToken:   ${mseccoAddr}`);
  console.log(`AgentPassport: ${passportAddr}`);
  console.log(`AiFinPayCore:  ${coreAddr}`);
  console.log(`Treasury:      ${treasury}`);
  console.log(`Owner:         ${owner}`);
  console.log(`Manifest:      ${manifestPath}`);

  console.log("\n--- Verify commands ---");
  console.log(`npx hardhat verify --network ${network.name} ${mseccoAddr} ${deployer.address}`);
  console.log(`npx hardhat verify --network ${network.name} ${passportAddr} ${deployer.address}`);
  console.log(`npx hardhat verify --network ${network.name} ${coreAddr} ${deployer.address} ${mseccoAddr} ${passportAddr} ${treasury} ${pyth} ${usdc} ${usdt} ${nativeUsdId}`);

  console.log("\n--- Next steps ---");
  console.log("1. Run the verify commands above");
  console.log(`2. Run DEPLOYMENT_MANIFEST=${manifestPath} npm run verify:deployment -- --network ${network.name}`);
  console.log("3. Commit the manifest and update SDK/MCP address registries from it");
}

main().catch((e) => { console.error(e); process.exit(1); });
