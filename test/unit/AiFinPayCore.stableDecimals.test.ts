import { expect } from "chai";

import { ethers } from "../fixtures";
import { Signer } from "ethers";
import type { AiFinPayCore, MockERC20 } from "../../typechain-types";

// AIFINP-120: AiFinPayCore assumed 6-decimal stablecoins via a fixed
// STABLE_DECIMALS_DIVISOR = 10_000. On BNB Chain USDC/USDT have 18 decimals,
// so $1 credited 10^14 cents ($1,000,000,000,000). The divisor is now derived
// per token from decimals() at deployment; these are the mandatory regression
// tests from the 2026-08-14 founder audit.

const MANIFESTO_HASH = "0x27b28e3044b56df3332a60c27604686a634f922a184f62398a4e2f85df19c699";

interface Deployment {
  owner: Signer;
  treasury: Signer;
  agent: Signer;
  core: AiFinPayCore;
  usdc: MockERC20;
  usdt: MockERC20;
}

async function deployWithDecimals(usdcDecimals: number, usdtDecimals: number): Promise<Deployment> {
  const [owner, treasury, agent] = await ethers.getSigners();

  const MockPythFactory = await ethers.getContractFactory("MockPyth");
  const mockPyth = await MockPythFactory.deploy();

  const MSECCOTokenFactory = await ethers.getContractFactory("MSECCOToken");
  const msecco = await MSECCOTokenFactory.deploy(await owner.getAddress());
  const AgentPassportFactory = await ethers.getContractFactory("AgentPassport");
  const passport = await AgentPassportFactory.deploy(await owner.getAddress());

  const MockERC20Factory = await ethers.getContractFactory("MockERC20");
  const usdc = (await MockERC20Factory.deploy("USD Coin", "USDC", usdcDecimals)) as unknown as MockERC20;
  const usdt = (await MockERC20Factory.deploy("Tether USD", "USDT", usdtDecimals)) as unknown as MockERC20;

  const AiFinPayCoreFactory = await ethers.getContractFactory("AiFinPayCore");
  const core = (await AiFinPayCoreFactory.deploy(
    await owner.getAddress(),
    await msecco.getAddress(),
    await passport.getAddress(),
    await treasury.getAddress(),
    await mockPyth.getAddress(),
    await usdc.getAddress(),
    await usdt.getAddress(),
    "0x5de33a9112c2b700b8d30b8a3402c103578ccfa2856a12a2b20d7b0c67b6d82d"
  )) as unknown as AiFinPayCore;

  await msecco.setCore(await core.getAddress());
  await passport.setCore(await core.getAddress());

  return { owner, treasury, agent, core, usdc, usdt };
}

async function fundAndApprove(d: Deployment, token: MockERC20, amount: bigint) {
  await token.mint(await d.agent.getAddress(), amount);
  await token.connect(d.agent).approve(await d.core.getAddress(), amount);
}

function oneDollar(decimals: number): bigint {
  return 10n ** BigInt(decimals);
}

describe("AiFinPayCore stablecoin decimal conversion (AIFINP-120)", function () {
  it("credits exactly 100 cents for $1 USDC at 6 decimals", async function () {
    const d = await deployWithDecimals(6, 6);
    const amount = oneDollar(6);
    await fundAndApprove(d, d.usdc, amount);
    await expect(
      d.core.connect(d.agent).reserveSeatStable(MANIFESTO_HASH, await d.usdc.getAddress(), amount, ethers.ZeroAddress)
    )
      .to.emit(d.core, "SeatReserved")
      .withArgs(await d.agent.getAddress(), 100n, 100n, 1);
    expect((await d.core.seats(await d.agent.getAddress())).usdCentsPaid).to.equal(100n);
  });

  it("credits exactly 100 cents for $1 USDT at 6 decimals", async function () {
    const d = await deployWithDecimals(6, 6);
    const amount = oneDollar(6);
    await fundAndApprove(d, d.usdt, amount);
    await expect(
      d.core.connect(d.agent).reserveSeatStable(MANIFESTO_HASH, await d.usdt.getAddress(), amount, ethers.ZeroAddress)
    )
      .to.emit(d.core, "SeatReserved")
      .withArgs(await d.agent.getAddress(), 100n, 100n, 2);
  });

  it("credits exactly 100 cents for $1 USDC at 18 decimals (the live BNB shape)", async function () {
    const d = await deployWithDecimals(18, 18);
    const amount = oneDollar(18);
    await fundAndApprove(d, d.usdc, amount);
    await expect(
      d.core.connect(d.agent).reserveSeatStable(MANIFESTO_HASH, await d.usdc.getAddress(), amount, ethers.ZeroAddress)
    )
      .to.emit(d.core, "SeatReserved")
      .withArgs(await d.agent.getAddress(), 100n, 100n, 1);
    expect((await d.core.seats(await d.agent.getAddress())).usdCentsPaid).to.equal(100n);
  });

  it("credits exactly 100 cents for $1 USDT at 18 decimals", async function () {
    const d = await deployWithDecimals(18, 18);
    const amount = oneDollar(18);
    await fundAndApprove(d, d.usdt, amount);
    await expect(
      d.core.connect(d.agent).reserveSeatStable(MANIFESTO_HASH, await d.usdt.getAddress(), amount, ethers.ZeroAddress)
    )
      .to.emit(d.core, "SeatReserved")
      .withArgs(await d.agent.getAddress(), 100n, 100n, 2);
  });

  it("truncates sub-cent dust and enforces the minimum at the exact cent boundary", async function () {
    // 6 decimals: one base unit under 10 cents is 9 cents -> below MIN_USD_CENTS.
    const d6 = await deployWithDecimals(6, 6);
    const tenCents6 = 10n * 10n ** 4n;
    await fundAndApprove(d6, d6.usdc, tenCents6 * 2n);
    await expect(
      d6.core
        .connect(d6.agent)
        .reserveSeatStable(MANIFESTO_HASH, await d6.usdc.getAddress(), tenCents6 - 1n, ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(d6.core, "BelowMinimum");
    await expect(
      d6.core
        .connect(d6.agent)
        .reserveSeatStable(MANIFESTO_HASH, await d6.usdc.getAddress(), tenCents6, ethers.ZeroAddress)
    )
      .to.emit(d6.core, "SeatReserved")
      .withArgs(await d6.agent.getAddress(), 10n, 10n, 1);

    // 18 decimals: the same boundary must land on the same cent values.
    const d18 = await deployWithDecimals(18, 18);
    const tenCents18 = 10n * 10n ** 16n;
    await fundAndApprove(d18, d18.usdc, tenCents18 * 2n);
    await expect(
      d18.core
        .connect(d18.agent)
        .reserveSeatStable(MANIFESTO_HASH, await d18.usdc.getAddress(), tenCents18 - 1n, ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(d18.core, "BelowMinimum");
    await expect(
      d18.core
        .connect(d18.agent)
        .reserveSeatStable(MANIFESTO_HASH, await d18.usdc.getAddress(), tenCents18, ethers.ZeroAddress)
    )
      .to.emit(d18.core, "SeatReserved")
      .withArgs(await d18.agent.getAddress(), 10n, 10n, 1);
  });

  it("reserveSeatStable and topUpStable share one conversion rule", async function () {
    for (const decimals of [6, 18]) {
      const d = await deployWithDecimals(decimals, decimals);
      const amount = oneDollar(decimals);
      await fundAndApprove(d, d.usdc, amount * 2n);
      await d.core
        .connect(d.agent)
        .reserveSeatStable(MANIFESTO_HASH, await d.usdc.getAddress(), amount, ethers.ZeroAddress);
      await expect(d.core.connect(d.agent).topUpStable(await d.usdc.getAddress(), amount))
        .to.emit(d.core, "TopUp")
        .withArgs(await d.agent.getAddress(), 100n, 100n);
      expect((await d.core.seats(await d.agent.getAddress())).usdCentsPaid).to.equal(200n);
    }
  });

  it("fails closed at deployment on token decimals it cannot represent", async function () {
    const reference = (await deployWithDecimals(6, 6)).core;
    // Below 2 decimals a whole cent has no base-unit representation.
    await expect(deployWithDecimals(1, 6)).to.be.revertedWithCustomError(
      reference,
      "UnsupportedTokenDecimals"
    );
    // Above the sanity bound the configuration is rejected rather than trusted.
    await expect(deployWithDecimals(6, 31)).to.be.revertedWithCustomError(
      reference,
      "UnsupportedTokenDecimals"
    );
  });

  it("carries no 10^12 factor between 6- and 18-decimal deployments", async function () {
    const d6 = await deployWithDecimals(6, 6);
    const d18 = await deployWithDecimals(18, 18);
    expect(await d6.core.USDC_CENTS_DIVISOR()).to.equal(10n ** 4n);
    expect(await d18.core.USDC_CENTS_DIVISOR()).to.equal(10n ** 16n);

    const dollars = 5n;
    await fundAndApprove(d6, d6.usdc, dollars * oneDollar(6));
    await fundAndApprove(d18, d18.usdc, dollars * oneDollar(18));
    await d6.core
      .connect(d6.agent)
      .reserveSeatStable(MANIFESTO_HASH, await d6.usdc.getAddress(), dollars * oneDollar(6), ethers.ZeroAddress);
    await d18.core
      .connect(d18.agent)
      .reserveSeatStable(MANIFESTO_HASH, await d18.usdc.getAddress(), dollars * oneDollar(18), ethers.ZeroAddress);

    const cents6 = (await d6.core.seats(await d6.agent.getAddress())).usdCentsPaid;
    const cents18 = (await d18.core.seats(await d18.agent.getAddress())).usdCentsPaid;
    expect(cents6).to.equal(500n);
    expect(cents18).to.equal(cents6);
  });
});
