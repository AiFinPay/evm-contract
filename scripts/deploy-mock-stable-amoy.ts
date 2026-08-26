/**
 * TESTNET ONLY — deploy a 6-decimal mock stablecoin on Polygon Amoy (80002).
 *
 * Circle's Amoy USDC is real and is what the USDC slot points at, but its
 * faucet is rate-limited, so a paid stablecoin E2E cannot be scheduled around
 * it. This mock fills the USDT slot instead: freely mintable, 6 decimals like
 * the real thing, so `payStable` can be exercised on demand.
 *
 * It proves the code path, not the asset. Nothing here is ever deployed to a
 * mainnet, and the deployment record labels the slot as a mock explicitly.
 */
import { network } from "hardhat";

const { ethers } = await network.create();

async function main() {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (chainId !== 80002) throw new Error(`Amoy only (80002); got ${chainId}`);

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} POL`);

  const Factory = await ethers.getContractFactory("MockERC20");
  const token = await Factory.deploy("Amoy Test Stable", "tUSD", 6);
  console.log(`Deploy tx: ${token.deploymentTransaction()?.hash}`);
  await token.waitForDeployment();
  const addr = await token.getAddress();

  // 1,000 tUSD — enough for many paid E2E runs without another faucet trip.
  const mintAmount = 1_000n * 10n ** 6n;
  const mintTx = await token.mint(deployer.address, mintAmount);
  await mintTx.wait();

  const decimals = Number(await token.decimals());
  const balance = await token.balanceOf(deployer.address);
  if (decimals !== 6) throw new Error(`Expected 6 decimals, chain reports ${decimals}`);

  console.log(`\nMock stable: ${addr}`);
  console.log(`  symbol   = ${await token.symbol()}`);
  console.log(`  decimals = ${decimals}`);
  console.log(`  minted   = ${ethers.formatUnits(balance, decimals)} to deployer`);
  console.log(`\nAMOY_TEST_STABLE=${addr}`);
}

await main();
