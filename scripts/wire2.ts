import { network } from "hardhat";

const { ethers } = await network.create();

const PASSPORT = "0x14Cd0CfD78A8F1DC6002D715d4147448a2DAc1Dd";
const CORE     = "0x1071Bb1C827223D3D0115B0e1f114adAb9ceB94f";

async function main() {
  const feeData = await ethers.provider.getFeeData();
  const gasPrice = feeData.gasPrice! * 2n;
  const passport = (await ethers.getContractFactory("AgentPassport")).attach(PASSPORT) as any;
  console.log("Setting core on AgentPassport...");
  const tx = await passport.setCore(CORE, { gasPrice });
  await tx.wait();
  console.log("Done. Tx:", tx.hash);
  console.log("passport.aifinpayCore:", await passport.aifinpayCore());
}

main().catch((e) => {
  console.error(e.message?.slice(0, 300));
  process.exit(1);
});
