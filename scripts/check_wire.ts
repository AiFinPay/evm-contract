import { network } from "hardhat";

const { ethers } = await network.create();

const MSECCO   = "0x522FAB7dC9c0607c3664969c732b7Bef163B662d";
const PASSPORT = "0x14Cd0CfD78A8F1DC6002D715d4147448a2DAc1Dd";
const CORE     = "0x1071Bb1C827223D3D0115B0e1f114adAb9ceB94f";

async function main() {
  const msecco = (await ethers.getContractFactory("MSECCOToken")).attach(MSECCO) as any;
  const passport = (await ethers.getContractFactory("AgentPassport")).attach(PASSPORT) as any;
  const core = (await ethers.getContractFactory("AiFinPayCore")).attach(CORE) as any;
  console.log("msecco.aifinpayCore:  ", await msecco.aifinpayCore());
  console.log("passport.aifinpayCore:", await passport.aifinpayCore());
  console.log("core.manifestoHash:   ", await core.manifestoHash());
  console.log("core.treasury:        ", await core.treasury());
  console.log("core.owner:           ", await core.owner());
  console.log("msecco.owner:         ", await msecco.owner());
  console.log("passport.owner:       ", await passport.owner());
}

main().catch((e) => {
  console.error(e.message?.slice(0, 200));
  process.exit(1);
});
