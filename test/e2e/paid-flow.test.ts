import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { fixtureWithSplitter } from "../fixtures";

// Real paid flows with balance-delta assertions (DD re-audit H-07).
//
// The previous "e2e" suite asserted configuration, constants and admin behaviour
// but never executed a funded payment. Every test here moves real value and
// asserts exact balance deltas on every recipient, plus the conservation
// invariant: input == merchant + treasury + ipCreator, with the contract
// retaining nothing.
//
// Each test carries a stable [E2E-nn] ID so DD scenario tables can reference
// unique tests rather than re-counting one test under several labels.

const BPS = 10_000n;

describe("Paid flows — funded transfers with exact balance deltas", () => {
  const AMOUNT = ethers.parseEther("1");

  async function balances(addrs: string[]) {
    return Promise.all(addrs.map((a) => ethers.provider.getBalance(a)));
  }

  describe("B2BSplitter v1.2 payNative", () => {
    it("[E2E-01] full paid flow: exact merchant/treasury/creator deltas, contract retains nothing", async () => {
      const { splitter, agent, merchant, treasury, ipCreator } = await loadFixture(fixtureWithSplitter);
      const [mAddr, tAddr, cAddr, sAddr] = [
        await merchant.getAddress(),
        await treasury.getAddress(),
        await ipCreator.getAddress(),
        await splitter.getAddress(),
      ];
      const [m0, t0, c0, s0] = await balances([mAddr, tAddr, cAddr, sAddr]);

      const treasuryBps = await splitter.treasuryBps();
      const creatorBps = await splitter.ipCreatorBps();
      const expTreasury = (AMOUNT * treasuryBps) / BPS;
      const expCreator = (AMOUNT * creatorBps) / BPS;
      const expMerchant = AMOUNT - expTreasury - expCreator;

      await splitter.connect(agent).payNative(ethers.id("e2e-01"), mAddr, cAddr, "order-e2e-01", { value: AMOUNT });

      const [m1, t1, c1, s1] = await balances([mAddr, tAddr, cAddr, sAddr]);
      expect(m1 - m0).to.equal(expMerchant);
      expect(t1 - t0).to.equal(expTreasury);
      expect(c1 - c0).to.equal(expCreator);
      // conservation: everything sent is accounted for, nothing retained
      expect(m1 - m0 + (t1 - t0) + (c1 - c0)).to.equal(AMOUNT);
      expect(s1).to.equal(s0);
    });

    it("[E2E-02] replay of a settled paymentId reverts and moves no value", async () => {
      const { splitter, agent, merchant, ipCreator } = await loadFixture(fixtureWithSplitter);
      const mAddr = await merchant.getAddress();
      const cAddr = await ipCreator.getAddress();
      const id = ethers.id("e2e-02");

      await splitter.connect(agent).payNative(id, mAddr, cAddr, "order-e2e-02", { value: AMOUNT });
      const [m1] = await balances([mAddr]);

      await expect(
        splitter.connect(agent).payNative(id, mAddr, cAddr, "order-e2e-02-replay", { value: AMOUNT })
      ).to.be.revertedWithCustomError(splitter, "PaymentAlreadyProcessed");

      const [m2] = await balances([mAddr]);
      expect(m2).to.equal(m1);
    });

    it("[E2E-03] zero ipCreator: the royalty share goes to the merchant, not the contract", async () => {
      const { splitter, agent, merchant, treasury } = await loadFixture(fixtureWithSplitter);
      const mAddr = await merchant.getAddress();
      const tAddr = await treasury.getAddress();
      const sAddr = await splitter.getAddress();
      const [m0, t0, s0] = await balances([mAddr, tAddr, sAddr]);

      const expTreasury = (AMOUNT * (await splitter.treasuryBps())) / BPS;

      await splitter.connect(agent).payNative(ethers.id("e2e-03"), mAddr, ethers.ZeroAddress, "order-e2e-03", { value: AMOUNT });

      const [m1, t1, s1] = await balances([mAddr, tAddr, sAddr]);
      expect(t1 - t0).to.equal(expTreasury);
      expect(m1 - m0).to.equal(AMOUNT - expTreasury); // absorbed the creator share
      expect(s1).to.equal(s0);
    });
  });

  describe("AiFinPayCore b2bPay — full protocol path: seat, passport, verification, payment", () => {
    async function verifiedAgentFixture() {
      const ctx = await loadFixture(fixtureWithSplitter);
      const { core, mockPyth, owner, agent, merchant, ipCreator } = ctx;

      await mockPyth.setMockPrice(300_000_000n); // $3.00 at expo -8
      const manifesto = await core.manifestoHash();
      await core.connect(agent).reserveSeatNative(manifesto, [], ethers.ZeroAddress, { value: ethers.parseEther("4") });
      await core.connect(agent).mintPassport(await ipCreator.getAddress(), ethers.id("meta"), 1_000_000n);
      await core.connect(owner).verifyAgentB2B(await agent.getAddress());
      await core.connect(owner).registerPartner(await merchant.getAddress(), "e2e-merchant");
      return ctx;
    }

    it("[E2E-04] full paid flow: exact merchant/treasury/creator deltas, contract retains nothing", async () => {
      const { core, agent, merchant, treasury, ipCreator } = await verifiedAgentFixture();
      const [mAddr, tAddr, cAddr, coreAddr] = [
        await merchant.getAddress(),
        await treasury.getAddress(),
        await ipCreator.getAddress(),
        await core.getAddress(),
      ];
      const [m0, t0, c0, k0] = await balances([mAddr, tAddr, cAddr, coreAddr]);

      const expTreasury = (AMOUNT * (await core.treasuryBps())) / BPS;
      const expCreator = (AMOUNT * (await core.ipCreatorBps())) / BPS;

      await core.connect(agent).b2bPay(mAddr, "order-e2e-04", { value: AMOUNT });

      const [m1, t1, c1, k1] = await balances([mAddr, tAddr, cAddr, coreAddr]);
      expect(t1 - t0).to.equal(expTreasury);
      expect(c1 - c0).to.equal(expCreator);
      expect(m1 - m0).to.equal(AMOUNT - expTreasury - expCreator);
      expect(m1 - m0 + (t1 - t0) + (c1 - c0)).to.equal(AMOUNT);
      expect(k1).to.equal(k0);
    });

    it("[E2E-05] zero-ipCreator passport: no value is stranded in the contract (H-02 regression)", async () => {
      const { core, mockPyth, owner, attacker, merchant, treasury } = await loadFixture(fixtureWithSplitter);
      // attacker plays a second agent whose passport has NO ip creator
      await mockPyth.setMockPrice(300_000_000n);
      const manifesto = await core.manifestoHash();
      await core.connect(attacker).reserveSeatNative(manifesto, [], ethers.ZeroAddress, { value: ethers.parseEther("4") });
      await core.connect(attacker).mintPassport(ethers.ZeroAddress, ethers.id("meta"), 1_000_000n);
      await core.connect(owner).verifyAgentB2B(await attacker.getAddress());
      await core.connect(owner).registerPartner(await merchant.getAddress(), "e2e-merchant");

      const [mAddr, tAddr, coreAddr] = [
        await merchant.getAddress(),
        await treasury.getAddress(),
        await core.getAddress(),
      ];
      const [m0, t0, k0] = await balances([mAddr, tAddr, coreAddr]);

      const expTreasury = (AMOUNT * (await core.treasuryBps())) / BPS;

      await core.connect(attacker).b2bPay(mAddr, "order-e2e-05", { value: AMOUNT });

      const [m1, t1, k1] = await balances([mAddr, tAddr, coreAddr]);
      expect(t1 - t0).to.equal(expTreasury);
      // the would-be royalty share reaches the merchant instead of stranding
      expect(m1 - m0).to.equal(AMOUNT - expTreasury);
      // the invariant the DD claims: the contract's balance cannot grow from a payment
      expect(k1).to.equal(k0);
    });

    it("[E2E-06] value conservation holds across many payment sizes (bounded fuzz)", async () => {
      const { core, agent, merchant, treasury, ipCreator } = await verifiedAgentFixture();
      const [mAddr, tAddr, cAddr, coreAddr] = [
        await merchant.getAddress(),
        await treasury.getAddress(),
        await ipCreator.getAddress(),
        await core.getAddress(),
      ];
      const k0 = await ethers.provider.getBalance(coreAddr);

      // awkward, rounding-hostile amounts — not round numbers
      const amounts = ["0.010000000000000001", "0.0123456789", "1.999999999999999999", "3.141592653589793238"];
      for (const [i, a] of amounts.entries()) {
        const v = ethers.parseEther(a);
        const [m0, t0, c0] = await balances([mAddr, tAddr, cAddr]);
        await core.connect(agent).b2bPay(mAddr, `order-e2e-06-${i}`, { value: v });
        const [m1, t1, c1] = await balances([mAddr, tAddr, cAddr]);
        expect(m1 - m0 + (t1 - t0) + (c1 - c0)).to.equal(v);
      }
      expect(await ethers.provider.getBalance(coreAddr)).to.equal(k0);
    });
  });
});
