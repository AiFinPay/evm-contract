import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { B2BSplitter, MockStable } from "../../typechain-types";

// Funded payStable flows across token decimals (ticket acceptance: 6- and
// 18-decimal assets, micro-payments, rounding, zero creator).
//
// payStable never takes custody: it pulls from the payer straight to each
// recipient with transferFrom. The conservation invariant here is therefore
// payer-side — the payer is debited exactly merchant + treasury + creator —
// and the contract's token balance must stay zero on every branch.

const BPS = 10_000n;

describe("Paid flows — payStable across 6- and 18-decimal assets", () => {
  async function stableFixture() {
    const [owner, treasury, agent, merchant, ipCreator] = await ethers.getSigners();
    const Mock = await ethers.getContractFactory("MockStable");
    const usdc = (await Mock.deploy("mockUSDC", 6)) as unknown as MockStable;   // USDC-like
    const usdt = (await Mock.deploy("mockUSDT", 18)) as unknown as MockStable;  // 18-decimal token
    const Splitter = await ethers.getContractFactory("B2BSplitter");
    const splitter = (await Splitter.deploy(
      await owner.getAddress(),
      await treasury.getAddress(),
      await usdc.getAddress(),
      await usdt.getAddress()
    )) as unknown as B2BSplitter;
    for (const t of [usdc, usdt]) {
      await t.mint(await agent.getAddress(), ethers.parseUnits("1000000", await t.decimals()));
      await t.connect(agent).approve(await splitter.getAddress(), ethers.MaxUint256);
    }
    return { owner, treasury, agent, merchant, ipCreator, usdc, usdt, splitter };
  }

  for (const [label, tokenKey, decimals] of [
    ["6-decimal (USDC-like)", "usdc", 6],
    ["18-decimal", "usdt", 18],
  ] as const) {
    describe(label, () => {
      it(`[E2E-07/${decimals}] exact deltas on every recipient; payer debited exactly the total; contract holds nothing`, async () => {
        const f = await stableFixture();
        const token = f[tokenKey];
        const amount = ethers.parseUnits("123.456789", decimals);
        const [aAddr, mAddr, tAddr, cAddr, sAddr] = await Promise.all(
          [f.agent, f.merchant, f.treasury, f.ipCreator].map((s) => s.getAddress())
        ).then((a) => [...a, undefined as unknown as string]);
        const splitterAddr = await f.splitter.getAddress();

        const expTreasury = (amount * (await f.splitter.treasuryBps())) / BPS;
        const expCreator = (amount * (await f.splitter.ipCreatorBps())) / BPS;
        const a0 = await token.balanceOf(aAddr);

        await f.splitter.connect(f.agent)
          .payStable(ethers.id(`stable-${decimals}`), await token.getAddress(), amount, mAddr, cAddr, "o1");

        expect(await token.balanceOf(mAddr)).to.equal(amount - expTreasury - expCreator);
        expect(await token.balanceOf(tAddr)).to.equal(expTreasury);
        expect(await token.balanceOf(cAddr)).to.equal(expCreator);
        // payer-side conservation: debited exactly the distributed total
        expect(a0 - (await token.balanceOf(aAddr))).to.equal(amount);
        expect(await token.balanceOf(splitterAddr)).to.equal(0n);
      });

      it(`[E2E-08/${decimals}] zero creator: the payer is never debited the creator slice and nothing is retained`, async () => {
        const f = await stableFixture();
        const token = f[tokenKey];
        const amount = ethers.parseUnits("50", decimals);
        const mAddr = await f.merchant.getAddress();
        const a0 = await token.balanceOf(await f.agent.getAddress());

        const expTreasury = (amount * (await f.splitter.treasuryBps())) / BPS;

        await f.splitter.connect(f.agent)
          .payStable(ethers.id(`stable-zc-${decimals}`), await token.getAddress(), amount, mAddr, ethers.ZeroAddress, "o2");

        // creator share folds into the merchant amount (same rule as payNative)
        expect(await token.balanceOf(mAddr)).to.equal(amount - expTreasury);
        expect(a0 - (await token.balanceOf(await f.agent.getAddress()))).to.equal(amount);
        expect(await token.balanceOf(await f.splitter.getAddress())).to.equal(0n);
      });

      it(`[E2E-09/${decimals}] micro-payments below MIN_PAYMENT revert; at the minimum the royalty cannot round to zero`, async () => {
        const f = await stableFixture();
        const token = f[tokenKey];
        // MIN_PAYMENT = 100,000 base units gates first, so with ipCreatorBps = 1
        // over 10,000 the smallest admissible payment already yields a royalty
        // of 10 — rounding-to-zero is unreachable above the minimum, and below
        // it the payment is rejected outright rather than shorting the creator.
        await expect(
          f.splitter.connect(f.agent).payStable(
            ethers.id(`stable-micro-${decimals}`), await token.getAddress(), 99_999n,
            await f.merchant.getAddress(), await f.ipCreator.getAddress(), "o3")
        ).to.be.revertedWithCustomError(f.splitter, "PaymentBelowMinimum");

        const min = await f.splitter.MIN_PAYMENT();
        const cAddr = await f.ipCreator.getAddress();
        const c0 = await token.balanceOf(cAddr);
        await f.splitter.connect(f.agent).payStable(
          ethers.id(`stable-min-${decimals}`), await token.getAddress(), min,
          await f.merchant.getAddress(), cAddr, "o3b");
        expect((await token.balanceOf(cAddr)) - c0)
          .to.equal((min * (await f.splitter.ipCreatorBps())) / BPS);
      });

      it(`[E2E-10/${decimals}] replay of a settled stable paymentId reverts and moves no tokens`, async () => {
        const f = await stableFixture();
        const token = f[tokenKey];
        const amount = ethers.parseUnits("10", decimals);
        const id = ethers.id(`stable-replay-${decimals}`);
        const mAddr = await f.merchant.getAddress();
        await f.splitter.connect(f.agent)
          .payStable(id, await token.getAddress(), amount, mAddr, await f.ipCreator.getAddress(), "o4");
        const m1 = await token.balanceOf(mAddr);
        await expect(
          f.splitter.connect(f.agent)
            .payStable(id, await token.getAddress(), amount, mAddr, await f.ipCreator.getAddress(), "o4r")
        ).to.be.revertedWithCustomError(f.splitter, "PaymentAlreadyProcessed");
        expect(await token.balanceOf(mAddr)).to.equal(m1);
      });
    });
  }

  it("[E2E-11] rounding-hostile fuzz: payer debit equals recipient credits for awkward amounts on both decimal scales", async () => {
    const f = await stableFixture();
    for (const [token, dec] of [[f.usdc, 6], [f.usdt, 18]] as const) {
      for (const [i, raw] of ["100000", "100001", "333333", "999999999"].entries()) {
        const amount = BigInt(raw) * 10n ** BigInt(dec > 6 ? 10 : 0); // >= MIN_PAYMENT on both scales
        const [aAddr, mAddr, tAddr, cAddr] = await Promise.all(
          [f.agent, f.merchant, f.treasury, f.ipCreator].map((s) => s.getAddress()));
        const before = await Promise.all([aAddr, mAddr, tAddr, cAddr].map((a) => token.balanceOf(a)));
        await f.splitter.connect(f.agent)
          .payStable(ethers.id(`fuzz-${dec}-${i}`), await token.getAddress(), amount, mAddr, cAddr, "of");
        const after = await Promise.all([aAddr, mAddr, tAddr, cAddr].map((a) => token.balanceOf(a)));
        const debit = before[0] - after[0];
        const credit = after[1] - before[1] + (after[2] - before[2]) + (after[3] - before[3]);
        expect(debit).to.equal(amount);
        expect(credit).to.equal(amount);
      }
      expect(await token.balanceOf(await f.splitter.getAddress())).to.equal(0n);
    }
  });
});
