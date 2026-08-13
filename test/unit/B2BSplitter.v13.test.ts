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
    USDC_PLACEHOLDER,
    USDT_PLACEHOLDER,
    treasuryBps,
    ipCreatorBps
  );
  return { owner, treasury, agent, merchant, ipCreator, splitter };
}

/** AIFP-1 monetisation profile: 1% protocol fee, 0.01% creator leg. */
async function fixtureV13() {
  return deployV13(100, 1);
}

/** AIFP-2 / x402 agent-payment profile: no AiFinPay percentage at all. */
async function fixtureV13ZeroFee() {
  return deployV13(0, 0);
}

describe("B2BSplitter v1.3 — fee on top", () => {
  const MERCHANT_AMOUNT = ethers.parseEther("1");
  const TREASURY_FEE = (MERCHANT_AMOUNT * 100n) / 10_000n;
  const CREATOR_FEE = (MERCHANT_AMOUNT * 1n) / 10_000n;

  it("quotes merchant + 1% protocol + 0.01% creator on top", async () => {
    const { splitter, ipCreator } = await loadFixture(fixtureV13);
    const [merchant, treasury, creator, total] = await splitter.quoteTotal(
      MERCHANT_AMOUNT,
      await ipCreator.getAddress()
    );
    expect(merchant).to.equal(MERCHANT_AMOUNT);
    expect(treasury).to.equal(TREASURY_FEE);
    expect(creator).to.equal(CREATOR_FEE);
    expect(total).to.equal(MERCHANT_AMOUNT + TREASURY_FEE + CREATOR_FEE);
  });

  it("pays the merchant the full quoted amount exactly", async () => {
    const { splitter, treasury, agent, merchant, ipCreator } = await loadFixture(fixtureV13);
    const merchantAddress = await merchant.getAddress();
    const treasuryAddress = await treasury.getAddress();
    const creatorAddress = await ipCreator.getAddress();
    const total = MERCHANT_AMOUNT + TREASURY_FEE + CREATOR_FEE;

    const merchantBefore = await ethers.provider.getBalance(merchantAddress);
    const treasuryBefore = await ethers.provider.getBalance(treasuryAddress);
    const creatorBefore = await ethers.provider.getBalance(creatorAddress);

    await splitter.connect(agent).payNative(
      ethers.id("v13-payment-1"),
      merchantAddress,
      MERCHANT_AMOUNT,
      creatorAddress,
      "order-1",
      { value: total }
    );

    expect((await ethers.provider.getBalance(merchantAddress)) - merchantBefore).to.equal(MERCHANT_AMOUNT);
    expect((await ethers.provider.getBalance(treasuryAddress)) - treasuryBefore).to.equal(TREASURY_FEE);
    expect((await ethers.provider.getBalance(creatorAddress)) - creatorBefore).to.equal(CREATOR_FEE);
    expect(await ethers.provider.getBalance(await splitter.getAddress())).to.equal(0n);
  });

  it("charges no creator fee when no creator is supplied, without reducing merchant proceeds", async () => {
    const { splitter, treasury, agent, merchant } = await loadFixture(fixtureV13);
    const merchantAddress = await merchant.getAddress();
    const treasuryAddress = await treasury.getAddress();
    const total = MERCHANT_AMOUNT + TREASURY_FEE;

    const merchantBefore = await ethers.provider.getBalance(merchantAddress);
    const treasuryBefore = await ethers.provider.getBalance(treasuryAddress);

    await splitter.connect(agent).payNative(
      ethers.id("v13-payment-2"),
      merchantAddress,
      MERCHANT_AMOUNT,
      ethers.ZeroAddress,
      "order-2",
      { value: total }
    );

    expect((await ethers.provider.getBalance(merchantAddress)) - merchantBefore).to.equal(MERCHANT_AMOUNT);
    expect((await ethers.provider.getBalance(treasuryAddress)) - treasuryBefore).to.equal(TREASURY_FEE);
  });

  it("rejects underpayment and overpayment instead of silently changing the merchant amount", async () => {
    const { splitter, agent, merchant, ipCreator } = await loadFixture(fixtureV13);
    const expected = MERCHANT_AMOUNT + TREASURY_FEE + CREATOR_FEE;

    await expect(
      splitter.connect(agent).payNative(
        ethers.id("v13-payment-under"),
        await merchant.getAddress(),
        MERCHANT_AMOUNT,
        await ipCreator.getAddress(),
        "under",
        { value: expected - 1n }
      )
    ).to.be.revertedWithCustomError(splitter, "IncorrectNativeValue").withArgs(expected, expected - 1n);

    await expect(
      splitter.connect(agent).payNative(
        ethers.id("v13-payment-over"),
        await merchant.getAddress(),
        MERCHANT_AMOUNT,
        await ipCreator.getAddress(),
        "over",
        { value: expected + 1n }
      )
    ).to.be.revertedWithCustomError(splitter, "IncorrectNativeValue").withArgs(expected, expected + 1n);
  });

  it("retains v1.2 replay protection", async () => {
    const { splitter, agent, merchant } = await loadFixture(fixtureV13);
    const id = ethers.id("v13-replay");
    const total = MERCHANT_AMOUNT + TREASURY_FEE;

    await splitter.connect(agent).payNative(
      id,
      await merchant.getAddress(),
      MERCHANT_AMOUNT,
      ethers.ZeroAddress,
      "first",
      { value: total }
    );
    await expect(
      splitter.connect(agent).payNative(
        id,
        await merchant.getAddress(),
        MERCHANT_AMOUNT,
        ethers.ZeroAddress,
        "second",
        { value: total }
      )
    ).to.be.revertedWithCustomError(splitter, "PaymentAlreadyProcessed");
  });

  describe("zero-fee profile (AIFP-2 / x402 agent payments)", () => {
    it("deploys at 0 bps and quotes no fee at all", async () => {
      const { splitter, ipCreator } = await loadFixture(fixtureV13ZeroFee);
      expect(await splitter.treasuryBps()).to.equal(0n);
      expect(await splitter.ipCreatorBps()).to.equal(0n);

      const [merchant, treasury, creator, total] = await splitter.quoteTotal(
        MERCHANT_AMOUNT,
        await ipCreator.getAddress()
      );
      expect(merchant).to.equal(MERCHANT_AMOUNT);
      expect(treasury).to.equal(0n);
      expect(creator).to.equal(0n);
      expect(total).to.equal(MERCHANT_AMOUNT);
    });

    it("pays the merchant 100% and moves nothing to treasury or creator", async () => {
      const { splitter, treasury, agent, merchant, ipCreator } = await loadFixture(fixtureV13ZeroFee);
      const merchantAddress = await merchant.getAddress();
      const treasuryAddress = await treasury.getAddress();
      const creatorAddress = await ipCreator.getAddress();

      const merchantBefore = await ethers.provider.getBalance(merchantAddress);
      const treasuryBefore = await ethers.provider.getBalance(treasuryAddress);
      const creatorBefore = await ethers.provider.getBalance(creatorAddress);

      await splitter.connect(agent).payNative(
        ethers.id("v13-zero-fee"),
        merchantAddress,
        MERCHANT_AMOUNT,
        creatorAddress,
        "zero-fee-order",
        { value: MERCHANT_AMOUNT }
      );

      expect((await ethers.provider.getBalance(merchantAddress)) - merchantBefore).to.equal(MERCHANT_AMOUNT);
      expect((await ethers.provider.getBalance(treasuryAddress)) - treasuryBefore).to.equal(0n);
      expect((await ethers.provider.getBalance(creatorAddress)) - creatorBefore).to.equal(0n);
      expect(await ethers.provider.getBalance(await splitter.getAddress())).to.equal(0n);
    });

    it("still rejects an over- or under-payment when the fee is zero", async () => {
      const { splitter, agent, merchant } = await loadFixture(fixtureV13ZeroFee);
      await expect(
        splitter.connect(agent).payNative(
          ethers.id("v13-zero-fee-over"),
          await merchant.getAddress(),
          MERCHANT_AMOUNT,
          ethers.ZeroAddress,
          "over",
          { value: MERCHANT_AMOUNT + 1n }
        )
      )
        .to.be.revertedWithCustomError(splitter, "IncorrectNativeValue")
        .withArgs(MERCHANT_AMOUNT, MERCHANT_AMOUNT + 1n);
    });

    it("can be switched to zero after deployment", async () => {
      const { splitter, owner } = await loadFixture(fixtureV13);
      await expect(splitter.connect(owner).setSplit(0, 0))
        .to.emit(splitter, "SplitUpdated")
        .withArgs(0n, 0n);
      expect(await splitter.treasuryBps()).to.equal(0n);
    });
  });

  describe("owner authority is bounded", () => {
    it("caps the combined fee at MAX_TOTAL_FEE_BPS", async () => {
      const { splitter, owner } = await loadFixture(fixtureV13);
      const max = await splitter.MAX_TOTAL_FEE_BPS();
      await expect(splitter.connect(owner).setSplit(Number(max) + 1, 0))
        .to.be.revertedWithCustomError(splitter, "FeesExceedMaximum")
        .withArgs(max + 1n, max);
    });

    it("cannot be raised to take the whole payment", async () => {
      const { splitter, owner } = await loadFixture(fixtureV13);
      await expect(splitter.connect(owner).setSplit(9_999, 0)).to.be.revertedWithCustomError(
        splitter,
        "FeesExceedMaximum"
      );
    });

    it("counts both legs against the cap, not each separately", async () => {
      const { splitter, owner } = await loadFixture(fixtureV13);
      const max = Number(await splitter.MAX_TOTAL_FEE_BPS());
      await expect(splitter.connect(owner).setSplit(max, 1)).to.be.revertedWithCustomError(
        splitter,
        "FeesExceedMaximum"
      );
      await expect(splitter.connect(owner).setSplit(max, 0)).to.emit(splitter, "SplitUpdated");
    });

    it("refuses to deploy outside the cap", async () => {
      await expect(deployV13(9_999, 0)).to.be.revertedWithCustomError(
        await ethers.getContractFactory("B2BSplitterV13"),
        "FeesExceedMaximum"
      );
    });

    it("rejects a non-owner changing the split", async () => {
      const { splitter, agent } = await loadFixture(fixtureV13);
      await expect(splitter.connect(agent).setSplit(0, 0)).to.be.revertedWithCustomError(
        splitter,
        "OwnableUnauthorizedAccount"
      );
    });
  });
});
