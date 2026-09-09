import { network } from "hardhat";
import { runVerifyFromRecord } from "./lib/verify.js";

const { ethers, networkName } = await network.create();

async function main() {
  await runVerifyFromRecord(networkName, ethers);
  console.log("\n=== VERIFICATION COMPLETE ===");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
