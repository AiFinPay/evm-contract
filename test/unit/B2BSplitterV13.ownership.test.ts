import { expect } from "chai";

import { ethers, loadFixture } from "../fixtures";

const USDC_PLACEHOLDER = "0x1000000000000000000000000000000000000001";
const USDT_PLACEHOLDER = "0x1000000000000000000000000000000000000002";

async function fixture() {
  const [owner, treasury, incoming, stranger] = await ethers.getSigners();
  const Factory = await ethers.getContractFactory("B2BSplitterV13");
  const splitter = await Factory.deploy({
    initialOwner: await owner.getAddress(),
    treasury: await treasury.getAddress(),
    stablecoins: [USDC_PLACEHOLDER, USDT_PLACEHOLDER],
    treasuryBps: 100,
    ipCreatorBps: 0,
  });
  return { owner, treasury, incoming, stranger, splitter };
}

describe("B2BSplitterV13 — ownership hardening", () => {
  describe("renounceOwnership is disabled", () => {
    it("reverts for the owner", async () => {
      const { splitter } = await loadFixture(fixture);
      await expect(splitter.renounceOwnership()).to.be.revertedWithCustomError(
        splitter,
        "OwnershipRenouncementDisabled",
      );
    });

    it("reverts for a stranger too — there is no caller for whom it is correct", async () => {
      const { splitter, stranger } = await loadFixture(fixture);
      await expect(splitter.connect(stranger).renounceOwnership()).to.be.revertedWithCustomError(
        splitter,
        "OwnershipRenouncementDisabled",
      );
    });

    it("leaves the owner intact after a failed attempt", async () => {
      const { splitter, owner } = await loadFixture(fixture);
      await expect(splitter.renounceOwnership()).to.revert(ethers);
      expect(await splitter.owner()).to.equal(await owner.getAddress());
    });

    it("cannot be reached while paused either, so a paused splitter is never stranded", async () => {
      const { splitter, owner } = await loadFixture(fixture);
      await splitter.pause();
      await expect(splitter.renounceOwnership()).to.be.revertedWithCustomError(
        splitter,
        "OwnershipRenouncementDisabled",
      );
      expect(await splitter.owner()).to.equal(await owner.getAddress());
    });
  });

  describe("ownership transfer is two-step", () => {
    it("does not hand over on transferOwnership alone", async () => {
      const { splitter, owner, incoming } = await loadFixture(fixture);
      await splitter.transferOwnership(await incoming.getAddress());
      expect(await splitter.owner()).to.equal(await owner.getAddress());
      expect(await splitter.pendingOwner()).to.equal(await incoming.getAddress());
    });

    it("keeps the outgoing owner in control until the transfer is accepted", async () => {
      const { splitter, incoming } = await loadFixture(fixture);
      await splitter.transferOwnership(await incoming.getAddress());
      // The stop-lever must not go dead during the handover window.
      await expect(splitter.pause()).not.to.revert(ethers);
      expect(await splitter.paused()).to.equal(true);
    });

    it("completes only when the incoming owner accepts", async () => {
      const { splitter, incoming } = await loadFixture(fixture);
      await splitter.transferOwnership(await incoming.getAddress());
      await splitter.connect(incoming).acceptOwnership();
      expect(await splitter.owner()).to.equal(await incoming.getAddress());
      expect(await splitter.pendingOwner()).to.equal(ethers.ZeroAddress);
    });

    it("rejects acceptance from anyone who is not the pending owner", async () => {
      const { splitter, incoming, stranger } = await loadFixture(fixture);
      await splitter.transferOwnership(await incoming.getAddress());
      await expect(splitter.connect(stranger).acceptOwnership()).to.be.revertedWithCustomError(
        splitter,
        "OwnableUnauthorizedAccount",
      );
    });

    it("a mistyped address is recoverable — it can never accept, and the transfer can be reissued", async () => {
      const { splitter, owner, incoming } = await loadFixture(fixture);
      const typo = "0x000000000000000000000000000000000000dEaD";
      await splitter.transferOwnership(typo);
      expect(await splitter.owner()).to.equal(await owner.getAddress());
      await splitter.transferOwnership(await incoming.getAddress());
      await splitter.connect(incoming).acceptOwnership();
      expect(await splitter.owner()).to.equal(await incoming.getAddress());
    });

    it("the new owner holds the stop-levers and the old one does not", async () => {
      const { splitter, owner, incoming } = await loadFixture(fixture);
      await splitter.transferOwnership(await incoming.getAddress());
      await splitter.connect(incoming).acceptOwnership();
      await expect(splitter.connect(incoming).pause()).not.to.revert(ethers);
      await expect(splitter.connect(owner).unpause()).to.be.revertedWithCustomError(
        splitter,
        "OwnableUnauthorizedAccount",
      );
    });
  });
});
