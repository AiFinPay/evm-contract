import { network } from "hardhat";

const { ethers } = await network.create();

const MSECCO   = "0x522FAB7dC9c0607c3664969c732b7Bef163B662d";
const PASSPORT = "0x14Cd0CfD78A8F1DC6002D715d4147448a2DAc1Dd";
const CORE     = "0x1071Bb1C827223D3D0115B0e1f114adAb9ceB94f";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Wiring with:", deployer.address);

  const feeData = await ethers.provider.getFeeData();
  const gasPrice = feeData.gasPrice! * 2n;
  console.log("Gas price:", ethers.formatUnits(gasPrice, "gwei"), "gwei");

  const MSECCOToken   = await ethers.getContractFactory("MSECCOToken");
  const AgentPassport = await ethers.getContractFactory("AgentPassport");

  const msecco   = MSECCOToken.attach(MSECCO);
  const passport = AgentPassport.attach(PASSPORT);

  console.log("\nSetting core on MSECCOToken...");
  const tx1 = await msecco.setCore(CORE, { gasPrice });
  await tx1.wait();
  console.log("   Done. Tx:", tx1.hash);

  console.log("Setting core on AgentPassport...");
  const tx2 = await passport.setCore(CORE, { gasPrice });
  await tx2.wait();
  console.log("   Done. Tx:", tx2.hash);

  const coreFromMsecco   = await msecco.aifinpayCore();
  const coreFromPassport = await passport.aifinpayCore();
  console.log("\n=== VERIFICATION ===");
  console.log("msecco.aifinpayCore:  ", coreFromMsecco,   coreFromMsecco === CORE ? "✅" : "❌");
  console.log("passport.aifinpayCore:", coreFromPassport, coreFromPassport === CORE ? "✅" : "❌");

  console.log("\n=== ALL DONE ===");
  console.log("MSECCOToken:  ", MSECCO);
  console.log("AgentPassport:", PASSPORT);
  console.log("AiFinPayCore: ", CORE);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
