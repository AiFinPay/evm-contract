import { expect } from "chai";

import { ethers, loadFixture } from "../fixtures";

async function fixtureV13() {
  const [owner, treasury, agent, merchant, ipCreator] = await ethers.getSigners();
  const usdc = "0x1000000000000000000000000000000000000001";
  const usdt = "0x1000000000000000000000000000000000000002";
  const Factory = await ethers.getContractFactory("B2BSplitterV13");
  const splitter = await Factory.deploy(
    await owner.getAddress(),
    await treasury.getAddress(),
    usdc,
    usdt
  );
  return { owner, treasury, agent, merchant, ipCreator, splitter };
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
});
