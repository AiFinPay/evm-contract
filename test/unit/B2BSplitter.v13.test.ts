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
      { paymentId: paymentId("under"), merchant: await merchant.getAddress(), grossAmount: gross, ipCreator: ethers.ZeroAddress, validUntil: until, orderId: "under" },
      { value: gross - 1n }
    )).to.be.revertedWithCustomError(splitter, "IncorrectNativeValue").withArgs(gross, gross - 1n);
    await expect(splitter.connect(agent).payNative(
      { paymentId: paymentId("over"), merchant: await merchant.getAddress(), grossAmount: gross, ipCreator: ethers.ZeroAddress, validUntil: until, orderId: "over" },
      { value: gross + 1n }
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
      { paymentId: paymentId("native-aifp1"), merchant: await merchant.getAddress(), grossAmount: gross, ipCreator: ethers.ZeroAddress, validUntil: until, orderId: "order" },
      { value: gross }
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
      { paymentId: paymentId("expired"), merchant: await merchant.getAddress(), grossAmount: gross, ipCreator: ethers.ZeroAddress, validUntil: expired, orderId: "expired" },
      { value: gross }
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
      { paymentId: paymentId("native-aifp2"), merchant: await merchant.getAddress(), grossAmount: gross, ipCreator: await ipCreator.getAddress(), validUntil: until, orderId: "order" },
      { value: gross }
    );
    expect((await ethers.provider.getBalance(await treasury.getAddress())) - tb).to.equal(0n);
    expect((await ethers.provider.getBalance(await ipCreator.getAddress())) - cb).to.equal(0n);
  });

  it("retains replay protection", async () => {
    const { splitter, agent, merchant } = await loadFixture(fixtureAifp1);
    const id = paymentId("replay");
    const gross = 10_000n;
    const until = await deadline();
    await splitter.connect(agent).payNative(
      { paymentId: id, merchant: await merchant.getAddress(), grossAmount: gross, ipCreator: ethers.ZeroAddress, validUntil: until, orderId: "first" },
      { value: gross }
    );
    await expect(splitter.connect(agent).payNative(
      { paymentId: id, merchant: await merchant.getAddress(), grossAmount: gross, ipCreator: ethers.ZeroAddress, validUntil: until, orderId: "second" },
      { value: gross }
    ))
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

  // ── audit-coverage: payNative rejects zero paymentId (mirrors payStable) ────────
  it("payNative reverts on a zero paymentId before any value moves", async () => {
    const { splitter, agent, merchant } = await loadFixture(fixtureAifp1);
    const gross = 10_000n;
    const until = await deadline();
    const mb = await ethers.provider.getBalance(await merchant.getAddress());
    await expect(splitter.connect(agent).payNative(
      { paymentId: ethers.ZeroHash, merchant: await merchant.getAddress(), grossAmount: gross, ipCreator: ethers.ZeroAddress, validUntil: until, orderId: "zero" },
      { value: gross }
    )).to.be.revertedWithCustomError(splitter, "ZeroPaymentId");
    expect(await ethers.provider.getBalance(await merchant.getAddress())).to.equal(mb);
    expect(await splitter.consumedPayment(ethers.ZeroHash)).to.equal(false);
  });

  // ── audit-coverage: treasury rejects after merchant succeeded — atomic rollback ─────
  // EVM-level reverts unwind ALL state changes in the same transaction,
  // including the merchant transfer AND the consumedPayment write. So the
  // audit's [I-01] "payer-burn / merchant-windfall" risk does not exist in
  // practice — atomic rollback means no partial movement. The same id can be
  // retried against a working treasury.
  it("native: treasury rejection rolls back the merchant transfer atomically (no partial movement)", async () => {
    const [owner, agent, merchant] = await ethers.getSigners();
    const Reverter = await ethers.getContractFactory("MockReverter");
    const reverter = await Reverter.deploy();
    const Factory = await ethers.getContractFactory("B2BSplitterV13");
    const splitter = await Factory.deploy(
      await owner.getAddress(), await reverter.getAddress(), [USDC_PLACEHOLDER, USDT_PLACEHOLDER], 100, 0
    );
    const gross = 10_000n;
    const until = await deadline();
    const id = paymentId("partial-fail");
    const mb = await ethers.provider.getBalance(await merchant.getAddress());
    await expect(splitter.connect(agent).payNative(
      { paymentId: id, merchant: await merchant.getAddress(), grossAmount: gross, ipCreator: ethers.ZeroAddress, validUntil: until, orderId: "x" },
      { value: gross }
    )).to.be.revertedWithCustomError(splitter, "TreasuryTransferFailed");
    // Atomic rollback: merchant balance unchanged, splitter holds no value,
    // consumedPayment[id] is rolled back so the same id may be retried.
    expect(await ethers.provider.getBalance(await merchant.getAddress())).to.equal(mb);
    expect(await ethers.provider.getBalance(await splitter.getAddress())).to.equal(0n);
    expect(await splitter.consumedPayment(id)).to.equal(false);
  });

  // ── audit-coverage: treasury-update frontrun documents the trusted-treasury assumption ──
  it("treasury-update redirects the next payment (documented trusted-treasury assumption)", async () => {
    const { splitter, owner, agent, merchant, treasury } = await loadFixture(fixtureAifp1);
    const [, , , , , attacker] = await ethers.getSigners();
    const gross = 10_000n;
    const until = await deadline();
    // Owner rotates treasury to the attacker after deployment.
    await splitter.connect(owner).setTreasury(await attacker.getAddress());
    expect(await splitter.treasury()).to.equal(await attacker.getAddress());
    const tb = await ethers.provider.getBalance(await treasury.getAddress());
    const ab = await ethers.provider.getBalance(await attacker.getAddress());
    await splitter.connect(agent).payNative(
      { paymentId: paymentId("front"), merchant: await merchant.getAddress(), grossAmount: gross, ipCreator: ethers.ZeroAddress, validUntil: until, orderId: "y" },
      { value: gross }
    );
    expect((await ethers.provider.getBalance(await treasury.getAddress())) - tb).to.equal(0n);
    expect((await ethers.provider.getBalance(await attacker.getAddress())) - ab).to.equal(100n);
  });

  // ── audit-coverage: consumedPayment is monotonically set (replay-proof) ──────────
  it("consumedPayment writes true exactly once per id, regardless of caller/amount/timing", async () => {
    const { splitter, agent, merchant, treasury } = await loadFixture(fixtureAifp1);
    const until = await deadline();
    for (let i = 0; i < 5; i++) {
      const id = paymentId(`mono-${i}`);
      const gross = 10_000n + BigInt(i);
      expect(await splitter.consumedPayment(id)).to.equal(false);
      await splitter.connect(agent).payNative(
        { paymentId: id, merchant: await merchant.getAddress(), grossAmount: gross, ipCreator: ethers.ZeroAddress, validUntil: until, orderId: `o${i}` },
        { value: gross }
      );
      expect(await splitter.consumedPayment(id)).to.equal(true);
      // Same id, even with a different amount, reverts.
      await expect(splitter.connect(agent).payNative(
        { paymentId: id, merchant: await merchant.getAddress(), grossAmount: gross + 1n, ipCreator: ethers.ZeroAddress, validUntil: until, orderId: `o${i}b` },
        { value: gross + 1n }
      )).to.be.revertedWithCustomError(splitter, "PaymentAlreadyProcessed");
    }
  });

  // ── audit-coverage: a contract merchant that reverts rolls back consumedPayment too ─────
  // The CEI guard protects against RE-ENTRANT calls, not against a top-level
  // merchant revert. If the merchant reverts, the entire transaction rolls back
  // — including consumedPayment[id] = true — so the same id can be retried with
  // a working merchant. This documents the actual semantics, not an ideal one.
  it("a contract merchant that reverts on receive rolls back consumedPayment (retry is possible)", async () => {
    const [owner, treasury, agent, merchant] = await ethers.getSigners();
    const Reverter = await ethers.getContractFactory("MockReverter");
    const reverter = await Reverter.deploy();
    const Factory = await ethers.getContractFactory("B2BSplitterV13");
    const splitter = await Factory.deploy(
      await owner.getAddress(), await treasury.getAddress(), [USDC_PLACEHOLDER, USDT_PLACEHOLDER], 100, 0
    );
    const gross = 10_000n;
    const until = await deadline();
    const id = paymentId("merchant-reverts");
    await expect(splitter.connect(agent).payNative(
      { paymentId: id, merchant: await reverter.getAddress(), grossAmount: gross, ipCreator: ethers.ZeroAddress, validUntil: until, orderId: "z" },
      { value: gross }
    )).to.be.revertedWithCustomError(splitter, "MerchantTransferFailed");
    // Top-level revert unwinds consumedPayment; same id may be retried.
    expect(await splitter.consumedPayment(id)).to.equal(false);
    await expect(splitter.connect(agent).payNative(
      { paymentId: id, merchant: await merchant.getAddress(), grossAmount: gross, ipCreator: ethers.ZeroAddress, validUntil: until, orderId: "z" },
      { value: gross }
    )).to.not.revert(ethers);
    expect(await splitter.consumedPayment(id)).to.equal(true);
  });

  // ── audit-coverage: constructor emits WhitelistedTokensUpdated with no zero entries ─────
  it("constructor emits WhitelistedTokensUpdated with only non-zero tokens (no address(0))", async () => {
    const [owner, treasury] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("B2BSplitterV13");
    const tx = await Factory.deploy(
      await owner.getAddress(),
      await treasury.getAddress(),
      [ethers.ZeroAddress, USDC_PLACEHOLDER, ethers.ZeroAddress, USDT_PLACEHOLDER, ethers.ZeroAddress],
      100,
      0
    );
    await tx.waitForDeployment();
    const splitterAddr = await tx.getAddress();
    const splitter = Factory.attach(splitterAddr) as any;
    const filter = splitter.filters.WhitelistedTokensUpdated();
    const events = await splitter.queryFilter(filter, (await tx.deploymentTransaction())!.blockNumber!, (await tx.deploymentTransaction())!.blockNumber!);
    expect(events.length).to.equal(1);
    const tokens: string[] = (events[0].args as any).tokens;
    expect(tokens).to.deep.equal([USDC_PLACEHOLDER, USDT_PLACEHOLDER]);
  });

  // ── audit-coverage: gross=0 reverts on quote (defense-in-depth) ─────
  it("quoteTotal on AIFP-2 with gross=0 reverts ZeroAmount", async () => {
    const { splitter } = await loadFixture(fixtureAifp2);
    await expect(splitter.quoteTotal(0, ethers.ZeroAddress)).to.be.revertedWithCustomError(splitter, "ZeroAmount");
  });

  // ── audit-coverage [R-I-02]: empty _stablecoins reverts ZeroStablecoins ─────
  it("constructor reverts on empty stablecoin list (ZeroStablecoins)", async () => {
    const [owner, treasury] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("B2BSplitterV13");
    await expect(Factory.deploy(
      await owner.getAddress(),
      await treasury.getAddress(),
      [],
      100,
      0
    )).to.be.revertedWithCustomError(Factory, "ZeroStablecoins");
  });
});
