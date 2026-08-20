import { expect } from "chai";

import { ethers, loadFixture } from "../fixtures";

async function fixture(decimals = 6, treasuryBps = 100, creatorBps = 0) {
  const [owner, treasury, agent, merchant, creator] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MockERC20");
  const usdc = await Token.deploy("USD Coin", "USDC", decimals);
  const usdt = await Token.deploy("Tether", "USDT", decimals);
  const rogue = await Token.deploy("Rogue", "RGE", decimals);
  const Factory = await ethers.getContractFactory("B2BSplitterV13");
  const splitter = await Factory.deploy(
    await owner.getAddress(), await treasury.getAddress(), [await usdc.getAddress(), await usdt.getAddress()], treasuryBps, creatorBps
  );
  return { owner, treasury, agent, merchant, creator, usdc, usdt, rogue, splitter };
}
async function fixture6() { return fixture(6, 100, 0); }
async function fixture18() { return fixture(18, 100, 0); }
async function fixtureZero() { return fixture(6, 0, 0); }
const paymentId = (n: number) => ethers.zeroPadValue(ethers.toBeHex(n), 32);
async function deadline(offset = 3600) {
  const block = await ethers.provider.getBlock('latest');
  return BigInt((block?.timestamp || Math.floor(Date.now() / 1000)) + offset);
}

describe("B2BSplitter v1.3 — gross-inclusive stable settlement", () => {
  it("settles Standard 500 units as 495 merchant + 5 treasury + 0 creator", async () => {
    const { splitter, usdc, treasury, agent, merchant, creator } = await loadFixture(fixture6);
    const gross = 500n;
    const until = await deadline();
    const [m, t, c, total] = await splitter.quoteTotal(gross, await creator.getAddress());
    expect([m, t, c, total]).to.deep.equal([495n, 5n, 0n, 500n]);
    await usdc.mint(await agent.getAddress(), gross);
    await usdc.connect(agent).approve(await splitter.getAddress(), gross);
    await splitter.connect(agent).payStable(paymentId(1), await usdc.getAddress(), gross, await merchant.getAddress(), await creator.getAddress(), until, "standard");
    expect(await usdc.balanceOf(await merchant.getAddress())).to.equal(495n);
    expect(await usdc.balanceOf(await treasury.getAddress())).to.equal(5n);
    expect(await usdc.balanceOf(await creator.getAddress())).to.equal(0n);
    expect(await usdc.balanceOf(await splitter.getAddress())).to.equal(0n);
    expect(await usdc.balanceOf(await agent.getAddress())).to.equal(0n);
  });

  it("is decimal-agnostic", async () => {
    for (const fx of [fixture6, fixture18]) {
      const { splitter, usdc, agent, merchant } = await loadFixture(fx);
      const decimals = Number(await usdc.decimals());
      const gross = 10n ** BigInt(decimals);
      const until = await deadline();
      const [m, t, c, total] = await splitter.quoteTotal(gross, ethers.ZeroAddress);
      expect(t).to.equal(gross / 100n);
      expect(c).to.equal(0n);
      expect(m + t + c).to.equal(gross);
      expect(total).to.equal(gross);
      await usdc.mint(await agent.getAddress(), gross);
      await usdc.connect(agent).approve(await splitter.getAddress(), gross);
      await splitter.connect(agent).payStable(paymentId(decimals), await usdc.getAddress(), gross, await merchant.getAddress(), ethers.ZeroAddress, until, `d${decimals}`);
    }
  });

  it("rejects a non-configured token", async () => {
    const { splitter, rogue, agent, merchant } = await loadFixture(fixture6);
    const until = await deadline();
    await rogue.mint(await agent.getAddress(), 500n);
    await rogue.connect(agent).approve(await splitter.getAddress(), 500n);
    await expect(splitter.connect(agent).payStable(paymentId(30), await rogue.getAddress(), 500n, await merchant.getAddress(), ethers.ZeroAddress, until, "rogue"))
      .to.be.revertedWithCustomError(splitter, "UnsupportedToken");
  });

  it("owner can add and remove a token from the whitelist", async () => {
    const { splitter, owner, rogue } = await loadFixture(fixture6);
    const rogueAddr = await rogue.getAddress();
    await expect(splitter.connect(owner).setWhitelistedTokens([rogueAddr], [true]))
      .to.emit(splitter, "WhitelistedTokensUpdated")
      .withArgs([rogueAddr], [true]);
    expect(await splitter.whitelistedTokens(rogueAddr)).to.equal(true);

    await expect(splitter.connect(owner).setWhitelistedTokens([rogueAddr], [false]))
      .to.emit(splitter, "WhitelistedTokensUpdated")
      .withArgs([rogueAddr], [false]);
    expect(await splitter.whitelistedTokens(rogueAddr)).to.equal(false);
  });

  it("non-owner cannot update the whitelist", async () => {
    const { splitter, agent, rogue } = await loadFixture(fixture6);
    await expect(splitter.connect(agent).setWhitelistedTokens([await rogue.getAddress()], [true]))
      .to.be.revertedWithCustomError(splitter, "OwnableUnauthorizedAccount");
  });

  it("setWhitelistedTokens reverts on array length mismatch", async () => {
    const { splitter, owner, rogue } = await loadFixture(fixture6);
    await expect(splitter.connect(owner).setWhitelistedTokens([await rogue.getAddress()], [true, false]))
      .to.be.revertedWithCustomError(splitter, "ArrayLengthMismatch");
  });

  it("setWhitelistedTokens reverts on zero address", async () => {
    const { splitter, owner } = await loadFixture(fixture6);
    await expect(splitter.connect(owner).setWhitelistedTokens([ethers.ZeroAddress], [true]))
      .to.be.revertedWithCustomError(splitter, "ZeroAddress");
  });

  it("rejects only a charged fee leg that rounds to zero", async () => {
    const { splitter } = await loadFixture(fixture6);
    await expect(splitter.quoteTotal(99n, ethers.ZeroAddress)).to.be.revertedWithCustomError(splitter, "PaymentTooSmallForTreasury");
    const [m, t, c, total] = await splitter.quoteTotal(100n, ethers.ZeroAddress);
    expect([m, t, c, total]).to.deep.equal([99n, 1n, 0n, 100n]);
  });

  it("rejects an expired stable quote before transferFrom", async () => {
    const { splitter, usdc, agent, merchant } = await loadFixture(fixture6);
    const gross = 500n;
    const block = await ethers.provider.getBlock('latest');
    const expired = BigInt(block?.timestamp || 1);
    await ethers.provider.send('evm_mine', []);
    await usdc.mint(await agent.getAddress(), gross);
    await usdc.connect(agent).approve(await splitter.getAddress(), gross);
    await expect(splitter.connect(agent).payStable(paymentId(35), await usdc.getAddress(), gross, await merchant.getAddress(), ethers.ZeroAddress, expired, "expired"))
      .to.be.revertedWithCustomError(splitter, "PaymentExpired");
    expect(await usdc.balanceOf(await merchant.getAddress())).to.equal(0n);
  });

  it("settles one base unit at AIFP-2 0/0", async () => {
    const { splitter, usdc, agent, merchant, treasury } = await loadFixture(fixtureZero);
    const until = await deadline();
    const [m, t, c, total] = await splitter.quoteTotal(1n, ethers.ZeroAddress);
    expect([m, t, c, total]).to.deep.equal([1n, 0n, 0n, 1n]);
    await usdc.mint(await agent.getAddress(), 1n);
    await usdc.connect(agent).approve(await splitter.getAddress(), 1n);
    await splitter.connect(agent).payStable(paymentId(40), await usdc.getAddress(), 1n, await merchant.getAddress(), ethers.ZeroAddress, until, "one");
    expect(await usdc.balanceOf(await merchant.getAddress())).to.equal(1n);
    expect(await usdc.balanceOf(await treasury.getAddress())).to.equal(0n);
  });

  it("preserves replay protection", async () => {
    const { splitter, usdc, agent, merchant } = await loadFixture(fixture6);
    const gross = 500n;
    const until = await deadline();
    await usdc.mint(await agent.getAddress(), gross * 2n);
    await usdc.connect(agent).approve(await splitter.getAddress(), gross * 2n);
    const args = [paymentId(50), await usdc.getAddress(), gross, await merchant.getAddress(), ethers.ZeroAddress, until, "replay"] as const;
    await splitter.connect(agent).payStable(...args);
    await expect(splitter.connect(agent).payStable(...args)).to.be.revertedWithCustomError(splitter, "PaymentAlreadyProcessed");
  });
});
