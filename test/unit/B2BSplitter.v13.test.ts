import { expect } from "chai";

import { ethers, loadFixture } from "../fixtures";

const USDC_PLACEHOLDER = "0x1000000000000000000000000000000000000001";
const USDT_PLACEHOLDER = "0x1000000000000000000000000000000000000002";

async function deployV13(treasuryBps: number, ipCreatorBps: number) {
  const [owner, treasury, agent, merchant, ipCreator] = await ethers.getSigners();
  const Factory = await ethers.getContractFactory("B2BSplitterV13");
  const splitter = await Factory.deploy(
    await owner.getAddress(),
    await treasury.getAddress(),
    [USDC_PLACEHOLDER, USDT_PLACEHOLDER],
    treasuryBps,
    ipCreatorBps
  );
  return { owner, treasury, agent, merchant, ipCreator, splitter };
}

async function fixtureAifp1() { return deployV13(100, 0); }
async function fixtureAifp2() { return deployV13(0, 0); }
const paymentId = (s: string) => ethers.id(s);
async function deadline(offset = 3600) {
  const block = await ethers.provider.getBlock('latest');
  return BigInt((block?.timestamp || Math.floor(Date.now() / 1000)) + offset);
}

describe("B2BSplitter v1.3 — gross-inclusive native settlement", () => {
  it("splits AIFP-1 gross 99/1/0 without adding a fee on top", async () => {
    const { splitter } = await loadFixture(fixtureAifp1);
    const gross = 10_000n;
    const [merchant, treasury, creator, total] = await splitter.quoteTotal(gross, ethers.ZeroAddress);
    expect([merchant, treasury, creator, total]).to.deep.equal([9_900n, 100n, 0n, 10_000n]);
  });

  it("matches the AIFP-1 reference 6dp tiers exactly", async () => {
    const { splitter } = await loadFixture(fixtureAifp1);
    for (const [gross, merchant, fee] of [[500n, 495n, 5n], [2000n, 1980n, 20n], [5000n, 4950n, 50n]] as const) {
      const [m, t, c, total] = await splitter.quoteTotal(gross, ethers.ZeroAddress);
      expect([m, t, c, total]).to.deep.equal([merchant, fee, 0n, gross]);
    }
  });

  it("requires msg.value to equal gross exactly", async () => {
    const { splitter, agent, merchant } = await loadFixture(fixtureAifp1);
    const gross = ethers.parseEther("1");
    const until = await deadline();
    await expect(splitter.connect(agent).payNative(
      paymentId("under"), await merchant.getAddress(), gross, ethers.ZeroAddress, until, "under", { value: gross - 1n }
    )).to.be.revertedWithCustomError(splitter, "IncorrectNativeValue").withArgs(gross, gross - 1n);
    await expect(splitter.connect(agent).payNative(
      paymentId("over"), await merchant.getAddress(), gross, ethers.ZeroAddress, until, "over", { value: gross + 1n }
    )).to.be.revertedWithCustomError(splitter, "IncorrectNativeValue").withArgs(gross, gross + 1n);
  });

  it("moves exactly gross and leaves no value in the splitter", async () => {
    const { splitter, treasury, agent, merchant } = await loadFixture(fixtureAifp1);
    const gross = ethers.parseEther("1");
    const until = await deadline();
    const [merchantAmt, treasuryAmt] = await splitter.quoteTotal(gross, ethers.ZeroAddress);
    const mb = await ethers.provider.getBalance(await merchant.getAddress());
    const tb = await ethers.provider.getBalance(await treasury.getAddress());
    await splitter.connect(agent).payNative(
      paymentId("native-aifp1"), await merchant.getAddress(), gross, ethers.ZeroAddress, until, "order", { value: gross }
    );
    expect((await ethers.provider.getBalance(await merchant.getAddress())) - mb).to.equal(merchantAmt);
    expect((await ethers.provider.getBalance(await treasury.getAddress())) - tb).to.equal(treasuryAmt);
    expect(await ethers.provider.getBalance(await splitter.getAddress())).to.equal(0n);
  });

  it("rejects an expired quote before moving value", async () => {
    const { splitter, agent, merchant } = await loadFixture(fixtureAifp1);
    const gross = 10_000n;
    const block = await ethers.provider.getBlock('latest');
    const expired = BigInt(block?.timestamp || 1);
    await ethers.provider.send('evm_mine', []);
    await expect(splitter.connect(agent).payNative(
      paymentId("expired"), await merchant.getAddress(), gross, ethers.ZeroAddress, expired, "expired", { value: gross }
    )).to.be.revertedWithCustomError(splitter, "PaymentExpired");
  });

  it("keeps AIFP-2 at exact 0/0", async () => {
    const { splitter, treasury, agent, merchant, ipCreator } = await loadFixture(fixtureAifp2);
    const gross = 500n;
    const until = await deadline();
    const [merchantAmt, treasuryAmt, creatorAmt, total] = await splitter.quoteTotal(gross, await ipCreator.getAddress());
    expect([merchantAmt, treasuryAmt, creatorAmt, total]).to.deep.equal([500n, 0n, 0n, 500n]);
    const tb = await ethers.provider.getBalance(await treasury.getAddress());
    const cb = await ethers.provider.getBalance(await ipCreator.getAddress());
    await splitter.connect(agent).payNative(
      paymentId("native-aifp2"), await merchant.getAddress(), gross, await ipCreator.getAddress(), until, "order", { value: gross }
    );
    expect((await ethers.provider.getBalance(await treasury.getAddress())) - tb).to.equal(0n);
    expect((await ethers.provider.getBalance(await ipCreator.getAddress())) - cb).to.equal(0n);
  });

  it("retains replay protection", async () => {
    const { splitter, agent, merchant } = await loadFixture(fixtureAifp1);
    const id = paymentId("replay");
    const gross = 10_000n;
    const until = await deadline();
    await splitter.connect(agent).payNative(id, await merchant.getAddress(), gross, ethers.ZeroAddress, until, "first", { value: gross });
    await expect(splitter.connect(agent).payNative(id, await merchant.getAddress(), gross, ethers.ZeroAddress, until, "second", { value: gross }))
      .to.be.revertedWithCustomError(splitter, "PaymentAlreadyProcessed");
  });

  it("makes route economics immutable and rejects every non-production constructor profile", async () => {
    const { splitter } = await loadFixture(fixtureAifp1);
    expect(await splitter.treasuryBps()).to.equal(100n);
    expect(await splitter.ipCreatorBps()).to.equal(0n);
    expect(splitter.interface.hasFunction("setSplit(uint256,uint256)")).to.equal(false);

    const [owner, treasury] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("B2BSplitterV13");
    await expect(Factory.deploy(
      await owner.getAddress(),
      await treasury.getAddress(),
      [USDC_PLACEHOLDER, USDT_PLACEHOLDER],
      1,
      0
    )).to.be.revertedWithCustomError(Factory, "InvalidProductionSplit").withArgs(1n, 0n);
    await expect(Factory.deploy(
      await owner.getAddress(),
      await treasury.getAddress(),
      [USDC_PLACEHOLDER, USDT_PLACEHOLDER],
      100,
      1
    )).to.be.revertedWithCustomError(Factory, "InvalidProductionSplit").withArgs(100n, 1n);
  });

  it("owner can add and remove a token from the whitelist", async () => {
    const { splitter, owner } = await loadFixture(fixtureAifp1);
    const token = "0x3333333333333333333333333333333333333333";
    await expect(splitter.connect(owner).setWhitelistedTokens([token], [true]))
      .to.emit(splitter, "WhitelistedTokensUpdated")
      .withArgs([token], [true]);
    expect(await splitter.whitelistedTokens(token)).to.equal(true);

    await expect(splitter.connect(owner).setWhitelistedTokens([token], [false]))
      .to.emit(splitter, "WhitelistedTokensUpdated")
      .withArgs([token], [false]);
    expect(await splitter.whitelistedTokens(token)).to.equal(false);
  });

  it("non-owner cannot update the whitelist", async () => {
    const { splitter, agent } = await loadFixture(fixtureAifp1);
    const token = "0x3333333333333333333333333333333333333333";
    await expect(splitter.connect(agent).setWhitelistedTokens([token], [true]))
      .to.be.revertedWithCustomError(splitter, "OwnableUnauthorizedAccount");
  });

  it("setWhitelistedTokens reverts on array length mismatch", async () => {
    const { splitter, owner } = await loadFixture(fixtureAifp1);
    const token = "0x3333333333333333333333333333333333333333";
    await expect(splitter.connect(owner).setWhitelistedTokens([token], [true, false]))
      .to.be.revertedWithCustomError(splitter, "ArrayLengthMismatch");
  });

  it("setWhitelistedTokens reverts on zero address", async () => {
    const { splitter, owner } = await loadFixture(fixtureAifp1);
    await expect(splitter.connect(owner).setWhitelistedTokens([ethers.ZeroAddress], [true]))
      .to.be.revertedWithCustomError(splitter, "ZeroAddress");
  });
});
