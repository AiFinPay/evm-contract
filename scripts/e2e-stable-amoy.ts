/**
 * TESTNET ONLY — paid stablecoin end-to-end against a deployed v1.3 splitter.
 *
 * Mirrors the native E2E, one layer harder: an ERC-20 settlement needs an
 * allowance first, and the split is executed by three transferFrom calls
 * rather than value transfers. Balances are read from the token contract
 * before and after and asserted against the on-chain bps, so the evidence is
 * the chain's arithmetic and not this script's.
 *
 * Env: SPLITTER, STABLE, GROSS (whole token units, default 10).
 */
import { network } from "hardhat";

const { ethers } = await network.create();

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

async function main() {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (chainId !== 80002) throw new Error(`Amoy only (80002); got ${chainId}`);

  const splitterAddr = ethers.getAddress(process.env.SPLITTER!);
  const stableAddr = ethers.getAddress(process.env.STABLE!);
  const [payer] = await ethers.getSigners();

  const splitter = await ethers.getContractAt("B2BSplitterV13", splitterAddr);
  const token = new ethers.Contract(stableAddr, ERC20_ABI, payer);

  // The merchant is the second throwaway key; the treasury is read from the
  // contract so the assertion cannot drift from what was actually deployed.
  const merchant = ethers.getAddress("0x51348d46aAb30a0403f1e4ad940aC4e9fb515435");
  const treasury = await splitter.treasury();
  const treasuryBps = Number(await splitter.treasuryBps());
  const ipCreatorBps = Number(await splitter.ipCreatorBps());

  const decimals = Number(await token.decimals());
  const symbol = await token.symbol();
  const gross = BigInt(process.env.GROSS || "10") * 10n ** BigInt(decimals);

  const fmt = (v: bigint) => `${ethers.formatUnits(v, decimals)} ${symbol}`;
  console.log(`Splitter: ${splitterAddr}  (${treasuryBps}/${ipCreatorBps} bps)`);
  console.log(`Stable:   ${stableAddr}  ${symbol}, ${decimals} decimals`);
  console.log(`Gross:    ${fmt(gross)}\n`);

  const before = {
    merchant: await token.balanceOf(merchant),
    treasury: await token.balanceOf(treasury),
  };

  const approveTx = await token.approve(splitterAddr, gross);
  await approveTx.wait();
  console.log(`approve tx:   ${approveTx.hash}`);

  const paymentId = ethers.hexlify(ethers.randomBytes(32));
  const validUntil = Math.floor(Date.now() / 1000) + 3600;
  const payTx = await splitter.payStable(
    paymentId,
    stableAddr,
    gross,
    merchant,
    ethers.ZeroAddress,
    validUntil,
    "amoy-stable-e2e",
  );
  const receipt = await payTx.wait();
  console.log(`payStable tx: ${payTx.hash}  (block ${receipt?.blockNumber})\n`);

  const after = {
    merchant: await token.balanceOf(merchant),
    treasury: await token.balanceOf(treasury),
  };
  const merchantDelta = after.merchant - before.merchant;
  const treasuryDelta = after.treasury - before.treasury;

  const expectedTreasury = (gross * BigInt(treasuryBps)) / 10_000n;
  const expectedMerchant = gross - expectedTreasury;

  console.log(`merchant +${fmt(merchantDelta)}  (expected ${fmt(expectedMerchant)})`);
  console.log(`treasury +${fmt(treasuryDelta)}  (expected ${fmt(expectedTreasury)})`);

  if (merchantDelta !== expectedMerchant || treasuryDelta !== expectedTreasury) {
    throw new Error("Observed split does not match the on-chain fee profile.");
  }
  if (merchantDelta + treasuryDelta !== gross) {
    throw new Error("Legs do not sum to gross — settlement is not gross-inclusive.");
  }
  console.log(`\n✅ gross-inclusive split verified: legs sum to exactly ${fmt(gross)}`);
}

await main();
