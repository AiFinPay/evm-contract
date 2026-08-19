import { expect } from "chai";

import { ethers, loadFixture, fixtureWithSplitter } from "../fixtures";

// B2BSplitter v1.2 — audit-remediation behaviours (AIFINP-34 / 35 / 33).
// NOTE: authored offline (local build was RAM-constrained). Run `bun run hardhat test`
// on a CI machine to execute.
describe("B2BSplitter v1.2 — audit remediation", () => {
  const ID_A = ethers.id("payment-A");
  const ID_B = ethers.id("payment-B");
  const AMOUNT = ethers.parseEther("1");

  describe("AIFINP-34 — per-chain tokens", () => {
    it("whitelists the USDC/USDT passed at deployment", async () => {
      const { splitter } = await loadFixture(fixtureWithSplitter);
      expect(await splitter.whitelistedTokens("0x1000000000000000000000000000000000000001")).to.equal(true);
      expect(await splitter.whitelistedTokens("0x1000000000000000000000000000000000000002")).to.equal(true);
    });

    it("rejects address(0) as a payStable token", async () => {
      const { splitter, agent, merchant } = await loadFixture(fixtureWithSplitter);
      await expect(
        splitter
          .connect(agent)
          .payStable(ID_A, ethers.ZeroAddress, AMOUNT, await merchant.getAddress(), ethers.ZeroAddress, "o1")
      ).to.be.revertedWithCustomError(splitter, "UnsupportedToken");
    });

    it("owner can add and remove a token from the whitelist", async () => {
      const { splitter, owner } = await loadFixture(fixtureWithSplitter);
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
      const { splitter, agent } = await loadFixture(fixtureWithSplitter);
      const token = "0x3333333333333333333333333333333333333333";
      await expect(splitter.connect(agent).setWhitelistedTokens([token], [true]))
        .to.be.revertedWithCustomError(splitter, "OwnableUnauthorizedAccount");
    });

    it("setWhitelistedTokens reverts on array length mismatch", async () => {
      const { splitter, owner } = await loadFixture(fixtureWithSplitter);
      const token = "0x3333333333333333333333333333333333333333";
      await expect(splitter.connect(owner).setWhitelistedTokens([token], [true, false]))
        .to.be.revertedWithCustomError(splitter, "ArrayLengthMismatch");
    });

    it("setWhitelistedTokens reverts on zero address", async () => {
      const { splitter, owner } = await loadFixture(fixtureWithSplitter);
      await expect(splitter.connect(owner).setWhitelistedTokens([ethers.ZeroAddress], [true]))
        .to.be.revertedWithCustomError(splitter, "ZeroAddress");
    });
  });

  describe("AIFINP-35 — idempotency / replay protection", () => {
    it("reverts a zero paymentId", async () => {
      const { splitter, agent, merchant } = await loadFixture(fixtureWithSplitter);
      await expect(
        splitter
          .connect(agent)
          .payNative(ethers.ZeroHash, await merchant.getAddress(), ethers.ZeroAddress, "o1", { value: AMOUNT })
      ).to.be.revertedWithCustomError(splitter, "ZeroPaymentId");
    });

    it("settles a paymentId once, then reverts the replay", async () => {
      const { splitter, agent, merchant } = await loadFixture(fixtureWithSplitter);
      await splitter
        .connect(agent)
        .payNative(ID_A, await merchant.getAddress(), ethers.ZeroAddress, "o1", { value: AMOUNT });
      expect(await splitter.consumedPayment(ID_A)).to.equal(true);
      await expect(
        splitter
          .connect(agent)
          .payNative(ID_A, await merchant.getAddress(), ethers.ZeroAddress, "o1", { value: AMOUNT })
      ).to.be.revertedWithCustomError(splitter, "PaymentAlreadyProcessed");
    });

    it("still accepts a distinct paymentId (retry with a new id)", async () => {
      const { splitter, agent, merchant } = await loadFixture(fixtureWithSplitter);
      await splitter.connect(agent).payNative(ID_A, await merchant.getAddress(), ethers.ZeroAddress, "o1", { value: AMOUNT });
      await expect(
        splitter.connect(agent).payNative(ID_B, await merchant.getAddress(), ethers.ZeroAddress, "o1", { value: AMOUNT })
      ).to.not.revert(ethers);
    });
  });

  describe("AIFINP-33 — zero IP-creator does not strand value", () => {
    it("redirects the creator share to the merchant; nothing left in the contract", async () => {
      const { splitter, agent, merchant, treasury } = await loadFixture(fixtureWithSplitter);
      const mAddr = await merchant.getAddress();
      const tAddr = await treasury.getAddress();

      const mBefore = await ethers.provider.getBalance(mAddr);
      const tBefore = await ethers.provider.getBalance(tAddr);

      await splitter.connect(agent).payNative(ID_A, mAddr, ethers.ZeroAddress, "o1", { value: AMOUNT });

      const treasuryShare = (AMOUNT * 100n) / 10_000n; // treasuryBps = 100
      const mAfter = await ethers.provider.getBalance(mAddr);
      const tAfter = await ethers.provider.getBalance(tAddr);

      // merchant absorbs the creator share: total - treasury (NOT total - treasury - ip)
      expect(mAfter - mBefore).to.equal(AMOUNT - treasuryShare);
      expect(tAfter - tBefore).to.equal(treasuryShare);
      // invariant: nothing stranded in the splitter
      expect(await ethers.provider.getBalance(await splitter.getAddress())).to.equal(0n);
    });
  });
});
