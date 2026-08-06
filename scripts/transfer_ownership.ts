import { network } from "hardhat";

const { ethers } = await network.create();

const SAFE     = "0xD31d82c4b35DABaA2ad7023C89A78A052D1f3c8e";
const MSECCO   = "0x522FAB7dC9c0607c3664969c732b7Bef163B662d";
const PASSPORT = "0x14Cd0CfD78A8F1DC6002D715d4147448a2DAc1Dd";
const CORE     = "0x1071Bb1C827223D3D0115B0e1f114adAb9ceB94f";

async function main() {
  const feeData = await ethers.provider.getFeeData();
  const gasPrice = feeData.gasPrice! * 2n;
  for (const [name, addr, factory] of [
    ["MSECCOToken", MSECCO, "MSECCOToken"],
    ["AgentPassport", PASSPORT, "AgentPassport"],
    ["AiFinPayCore", CORE, "AiFinPayCore"],
  ] as const) {
    const c = (await ethers.getContractFactory(factory)).attach(addr) as any;
    const tx = await c.transferOwnership(SAFE, { gasPrice });
    await tx.wait();
    console.log(`${name} → Safe. Tx: ${tx.hash}`);
    console.log(`  owner now: ${await c.owner()}`);
  }
}

main().catch((e) => {
  console.error(e.message?.slice(0, 300));
  process.exit(1);
});
