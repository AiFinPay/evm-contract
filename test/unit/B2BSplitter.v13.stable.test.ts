import { expect } from "chai";

import { ethers, loadFixture } from "../fixtures";

/**
 * v1.3 stablecoin settlement, plus the value-conservation and boundary cases
 * §6.1 asks for: stablecoin payment, wrong token, micro amounts and decimal
 * variants.
 *
 * The theme running through all of it is the invariant that
 * `merchant + treasury + creator == total` on every branch, and that the
 * splitter never keeps anything. Fee-inclusive v1.1/v1.2 could round a
 * merchant's share down; fee-on-top must not, at any decimals or size.
 */
async function fixtureStable(decimals = 6, treasuryBps = 100, ipCreatorBps = 1) {
  const [owner, treasury, agent, merchant, ipCreator, outsider] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MockERC20");
  const usdc = await Token.deploy("USD Coin", "USDC", decimals);
  const usdt = await Token.deploy("Tether", "USDT", decimals);
  const rogue = await Token.deploy("Rogue", "RGE", decimals);

  const Factory = await ethers.getContractFactory("B2BSplitterV13");
  const splitter = await Factory.deploy(
    await owner.getAddress(),
    await treasury.getAddress(),
    await usdc.getAddress(),
    await usdt.getAddress(),
    treasuryBps,
    ipCreatorBps
  );
  return { owner, treasury, agent, merchant, ipCreator, outsider, usdc, usdt, rogue, splitter };
}

/** Zero-fee stable route: proves no zero-value ERC-20 transfer is attempted. */
async function fixtureStableZeroFee() {
  return fixtureStable(6, 0, 0);
}

async function fixture6() {
  return fixtureStable(6);
}

async function fixture18() {
  return fixtureStable(18);
}

const FIXTURES: Record<number, () => Promise<Awaited<ReturnType<typeof fixtureStable>>>> = {
  6: fixture6,
  18: fixture18,
};

const paymentId = (n: number) => ethers.zeroPadValue(ethers.toBeHex(n), 32);

describe("B2BSplitter v1.3 — stablecoin settlement", () => {
  it("pays the merchant the full quoted amount and keeps nothing", async () => {
    const { splitter, usdc, treasury, agent, merchant, ipCreator } = await loadFixture(fixture6);
    const merchantAmount = 1_000_000n; // 1.00 USDC
    const [, treasuryAmt, creatorAmt, total] = await splitter.quoteTotal(
      merchantAmount,
      await ipCreator.getAddress()
    );

    await usdc.mint(await agent.getAddress(), total);
    await usdc.connect(agent).approve(await splitter.getAddress(), total);
    await splitter
      .connect(agent)
      .payStable(
        paymentId(1),
        await usdc.getAddress(),
        merchantAmount,
        await merchant.getAddress(),
        await ipCreator.getAddress(),
        "order-stable-1"
      );

    expect(await usdc.balanceOf(await merchant.getAddress())).to.equal(merchantAmount);
    expect(await usdc.balanceOf(await treasury.getAddress())).to.equal(treasuryAmt);
    expect(await usdc.balanceOf(await ipCreator.getAddress())).to.equal(creatorAmt);
    // Nothing sticks to the contract, and the agent paid exactly the total.
    expect(await usdc.balanceOf(await splitter.getAddress())).to.equal(0n);
    expect(await usdc.balanceOf(await agent.getAddress())).to.equal(0n);
    expect(merchantAmount + treasuryAmt + creatorAmt).to.equal(total);
  });

  it("charges no creator fee when no creator is supplied", async () => {
    const { splitter, usdc, treasury, agent, merchant } = await loadFixture(fixture6);
    const merchantAmount = 1_000_000n;
    const [, treasuryAmt, creatorAmt, total] = await splitter.quoteTotal(
      merchantAmount,
      ethers.ZeroAddress
    );
    expect(creatorAmt).to.equal(0n);
    expect(total).to.equal(merchantAmount + treasuryAmt);

    await usdc.mint(await agent.getAddress(), total);
    await usdc.connect(agent).approve(await splitter.getAddress(), total);
    await splitter
      .connect(agent)
      .payStable(
        paymentId(2),
        await usdc.getAddress(),
        merchantAmount,
        await merchant.getAddress(),
        ethers.ZeroAddress,
        "order-stable-2"
      );

    expect(await usdc.balanceOf(await merchant.getAddress())).to.equal(merchantAmount);
    expect(await usdc.balanceOf(await treasury.getAddress())).to.equal(treasuryAmt);
    // The creator's share is not taken at all — it is not taken and stranded.
    expect(await usdc.balanceOf(await splitter.getAddress())).to.equal(0n);
  });

  it("refuses a token that is not the configured USDC or USDT", async () => {
    const { splitter, rogue, agent, merchant, ipCreator } = await loadFixture(fixture6);
    const merchantAmount = 1_000_000n;
    await rogue.mint(await agent.getAddress(), merchantAmount * 2n);
    await rogue.connect(agent).approve(await splitter.getAddress(), merchantAmount * 2n);

    await expect(
      splitter
        .connect(agent)
        .payStable(
          paymentId(3),
          await rogue.getAddress(),
          merchantAmount,
          await merchant.getAddress(),
          await ipCreator.getAddress(),
          "order-rogue"
        )
    ).to.be.revertedWithCustomError(splitter, "UnsupportedToken");
  });

  it("refuses the zero token address", async () => {
    const { splitter, agent, merchant, ipCreator } = await loadFixture(fixture6);
    await expect(
      splitter
        .connect(agent)
        .payStable(
          paymentId(4),
          ethers.ZeroAddress,
          1_000_000n,
          await merchant.getAddress(),
          await ipCreator.getAddress(),
          "order-zero-token"
        )
    ).to.be.revertedWithCustomError(splitter, "UnsupportedToken");
  });

  it("retains replay protection on the stablecoin path", async () => {
    const { splitter, usdc, agent, merchant, ipCreator } = await loadFixture(fixture6);
    const merchantAmount = 1_000_000n;
    const [, , , total] = await splitter.quoteTotal(merchantAmount, await ipCreator.getAddress());
    await usdc.mint(await agent.getAddress(), total * 2n);
    await usdc.connect(agent).approve(await splitter.getAddress(), total * 2n);

    const args = [
      paymentId(5),
      await usdc.getAddress(),
      merchantAmount,
      await merchant.getAddress(),
      await ipCreator.getAddress(),
      "order-replay",
    ] as const;
    await splitter.connect(agent).payStable(...args);
    await expect(splitter.connect(agent).payStable(...args)).to.be.revertedWithCustomError(
      splitter,
      "PaymentAlreadyProcessed"
    );
  });

  it("fails when the payer approved only the merchant amount, not the total", async () => {
    // The fee-on-top trap for an integrator ported from v1.2: approving the
    // quoted merchant amount is no longer enough.
    const { splitter, usdc, agent, merchant, ipCreator } = await loadFixture(fixture6);
    const merchantAmount = 1_000_000n;
    const [, , , total] = await splitter.quoteTotal(merchantAmount, await ipCreator.getAddress());
    await usdc.mint(await agent.getAddress(), total);
    await usdc.connect(agent).approve(await splitter.getAddress(), merchantAmount);

    await expect(
      splitter
        .connect(agent)
        .payStable(
          paymentId(6),
          await usdc.getAddress(),
          merchantAmount,
          await merchant.getAddress(),
          await ipCreator.getAddress(),
          "order-short-approval"
        )
    ).to.be.revertedWithCustomError(usdc, "ERC20InsufficientAllowance");
  });
});

describe("B2BSplitter v1.3 — decimals and micro amounts", () => {
  for (const decimals of [6, 18]) {
    it(`conserves value exactly on a ${decimals}-decimal token`, async () => {
      // BNB Chain's USDC is 18 decimals while most USDC is 6. The split must
      // not be derived from an assumed decimals value anywhere.
      const { splitter, usdc, treasury, agent, merchant, ipCreator } = await loadFixture(FIXTURES[decimals]!);
      const merchantAmount = 10n ** BigInt(decimals); // exactly 1 token
      const [, treasuryAmt, creatorAmt, total] = await splitter.quoteTotal(
        merchantAmount,
        await ipCreator.getAddress()
      );
      expect(treasuryAmt).to.equal(merchantAmount / 100n); // 1%
      expect(creatorAmt).to.equal(merchantAmount / 10_000n); // 0.01%

      await usdc.mint(await agent.getAddress(), total);
      await usdc.connect(agent).approve(await splitter.getAddress(), total);
      await splitter
        .connect(agent)
        .payStable(
          paymentId(10 + decimals),
          await usdc.getAddress(),
          merchantAmount,
          await merchant.getAddress(),
          await ipCreator.getAddress(),
          `order-dec-${decimals}`
        );

      const paid =
        (await usdc.balanceOf(await merchant.getAddress())) +
        (await usdc.balanceOf(await treasury.getAddress())) +
        (await usdc.balanceOf(await ipCreator.getAddress()));
      expect(paid).to.equal(total);
      expect(await usdc.balanceOf(await splitter.getAddress())).to.equal(0n);
    });
  }

  it("rejects only the amounts where a CHARGED fee would round to zero", async () => {
    // The floor is per fee leg, not a blanket minimum. With 100/1 bps the
    // creator leg is the binding constraint: it rounds to zero below 10,000
    // base units, so that is where the rejection comes from.
    const { splitter, ipCreator } = await loadFixture(fixture6);
    await expect(
      splitter.quoteTotal(9_999n, await ipCreator.getAddress())
    ).to.be.revertedWithCustomError(splitter, "PaymentTooSmallForRoyalty");

    // With no creator supplied, only the 1% treasury leg applies, so the
    // binding constraint drops to 100 base units — well below the old blanket
    // 100,000 floor, and low enough for the AIFP-1 per-request tiers.
    await expect(splitter.quoteTotal(99n, ethers.ZeroAddress)).to.be.revertedWithCustomError(
      splitter,
      "PaymentTooSmallForTreasury"
    );
    const [, treasuryAmt] = await splitter.quoteTotal(100n, ethers.ZeroAddress);
    expect(treasuryAmt).to.equal(1n);
  });

  it("rejects a zero merchant amount on any profile", async () => {
    const { splitter, ipCreator } = await loadFixture(fixture6);
    await expect(splitter.quoteTotal(0n, await ipCreator.getAddress())).to.be.revertedWithCustomError(
      splitter,
      "ZeroAmount"
    );
    const zero = await loadFixture(fixtureStableZeroFee);
    await expect(zero.splitter.quoteTotal(0n, ethers.ZeroAddress)).to.be.revertedWithCustomError(
      zero.splitter,
      "ZeroAmount"
    );
  });

  it("settles a 0/0 micropayment far below the old 100,000 floor", async () => {
    // AIFINP-119: at 0 bps there are no fee legs to round, so no minimum is
    // needed. AIFP-1 per-request tiers start at $0.0005, which is 500 base
    // units on a 6-decimal stablecoin — the old floor rejected all of them.
    const { splitter, usdc, treasury, agent, merchant, ipCreator } =
      await loadFixture(fixtureStableZeroFee);
    const merchantAmount = 500n; // $0.0005 at 6 decimals

    const [, treasuryAmt, creatorAmt, total] = await splitter.quoteTotal(
      merchantAmount,
      await ipCreator.getAddress()
    );
    expect(treasuryAmt).to.equal(0n);
    expect(creatorAmt).to.equal(0n);
    expect(total).to.equal(merchantAmount);

    await usdc.mint(await agent.getAddress(), merchantAmount);
    await usdc.connect(agent).approve(await splitter.getAddress(), merchantAmount);
    await splitter
      .connect(agent)
      .payStable(
        paymentId(9100),
        await usdc.getAddress(),
        merchantAmount,
        await merchant.getAddress(),
        await ipCreator.getAddress(),
        "micro-zero-fee"
      );

    expect(await usdc.balanceOf(await merchant.getAddress())).to.equal(merchantAmount);
    expect(await usdc.balanceOf(await treasury.getAddress())).to.equal(0n);
    expect(await usdc.balanceOf(await splitter.getAddress())).to.equal(0n);
  });

  it("settles a single base unit at 0/0", async () => {
    const { splitter, usdc, agent, merchant } = await loadFixture(fixtureStableZeroFee);
    await usdc.mint(await agent.getAddress(), 1n);
    await usdc.connect(agent).approve(await splitter.getAddress(), 1n);
    await splitter
      .connect(agent)
      .payStable(
        paymentId(9101),
        await usdc.getAddress(),
        1n,
        await merchant.getAddress(),
        ethers.ZeroAddress,
        "one-base-unit"
      );
    expect(await usdc.balanceOf(await merchant.getAddress())).to.equal(1n);
  });

  it("still pays every party a non-zero amount at the fee-rounding boundary", async () => {
    // With 100/1 bps the binding constraint is the creator leg at 10,000 base
    // units. Both fees must survive exactly that amount.
    const { splitter, usdc, treasury, agent, merchant, ipCreator } = await loadFixture(fixture6);
    const merchantAmount = 10_000n;
    const [, treasuryAmt, creatorAmt, total] = await splitter.quoteTotal(
      merchantAmount,
      await ipCreator.getAddress()
    );
    expect(treasuryAmt).to.be.greaterThan(0n);
    expect(creatorAmt).to.be.greaterThan(0n);

    await usdc.mint(await agent.getAddress(), total);
    await usdc.connect(agent).approve(await splitter.getAddress(), total);
    await splitter
      .connect(agent)
      .payStable(
        paymentId(99),
        await usdc.getAddress(),
        merchantAmount,
        await merchant.getAddress(),
        await ipCreator.getAddress(),
        "order-min"
      );

    expect(await usdc.balanceOf(await merchant.getAddress())).to.equal(merchantAmount);
    expect(await usdc.balanceOf(await treasury.getAddress())).to.equal(treasuryAmt);
    expect(await usdc.balanceOf(await ipCreator.getAddress())).to.equal(creatorAmt);
    expect(await usdc.balanceOf(await splitter.getAddress())).to.equal(0n);
  });

  it("keeps no native value on any branch", async () => {
    const { splitter, agent, merchant, ipCreator } = await loadFixture(fixture6);
    const merchantAmount = ethers.parseEther("1");
    for (const [id, creator] of [
      [200, await ipCreator.getAddress()],
      [201, ethers.ZeroAddress],
    ] as const) {
      const [, , , total] = await splitter.quoteTotal(merchantAmount, creator);
      await splitter
        .connect(agent)
        .payNative(
          paymentId(id),
          await merchant.getAddress(),
          merchantAmount,
          creator,
          `order-native-${id}`,
          { value: total }
        );
      expect(await ethers.provider.getBalance(await splitter.getAddress())).to.equal(0n);
    }
  });

  it("moves the full amount to the merchant and skips the zero-value fee transfers at 0 bps", async () => {
    const { splitter, usdc, treasury, agent, merchant, ipCreator } = await loadFixture(fixtureStableZeroFee);
    const merchantAmount = 1_000_000n; // 1.00 USDC
    const [, treasuryAmt, creatorAmt, total] = await splitter.quoteTotal(
      merchantAmount,
      await ipCreator.getAddress()
    );
    expect(treasuryAmt).to.equal(0n);
    expect(creatorAmt).to.equal(0n);
    expect(total).to.equal(merchantAmount);

    // Approve only the merchant amount. If the contract attempted a zero-value
    // transfer leg it would still pass, but tokens that revert on zero-value
    // transfers would break the route — so the legs must be skipped entirely.
    await usdc.mint(await agent.getAddress(), merchantAmount);
    await usdc.connect(agent).approve(await splitter.getAddress(), merchantAmount);
    await splitter
      .connect(agent)
      .payStable(
        paymentId(9001),
        await usdc.getAddress(),
        merchantAmount,
        await merchant.getAddress(),
        await ipCreator.getAddress(),
        "order-zero-fee"
      );

    expect(await usdc.balanceOf(await merchant.getAddress())).to.equal(merchantAmount);
    expect(await usdc.balanceOf(await treasury.getAddress())).to.equal(0n);
    expect(await usdc.balanceOf(await ipCreator.getAddress())).to.equal(0n);
    expect(await usdc.balanceOf(await splitter.getAddress())).to.equal(0n);
  });
});
