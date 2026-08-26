import { expect } from "chai";

import { ethers, loadFixture, fixture } from "../fixtures";
import { Signer } from "ethers";
import { AgentPassport, AiFinPayCore, MSECCOToken } from "../../typechain-types";

describe("Integration: Core ↔ MSECCOToken", function () {
  let owner: Signer, treasury: Signer, agent: Signer, merchant: Signer;
  let msecco: MSECCOToken, passport: AgentPassport, core: AiFinPayCore;

  beforeEach(async function () {
    ({ owner, treasury, agent, merchant, msecco, passport, core } = await loadFixture(fixture));
  });

  describe("Initial State", function () {
    it("totalSupply starts at zero", async function () {
      expect(await msecco.totalSupply()).to.equal(0n);
    });

    it("seat data initialized correctly", async function () {
      const seat = await core.seats(await owner.getAddress());
      expect(seat.usdCentsPaid).to.equal(0n);
      expect(seat.mseccoBalance).to.equal(0n);
    });

    it("passport and core linked bi-directionally", async function () {
      expect(await passport.aifinpayCore()).to.equal(await core.getAddress());
      expect(await msecco.aifinpayCore()).to.equal(await core.getAddress());
    });

    it("only core can mint, not owner", async function () {
      await expect(msecco.connect(owner).mint(await agent.getAddress(), 1000))
        .to.be.revertedWithCustomError(msecco, "OnlyCore");
    });
  });
});

describe("Integration: B2BSplitter with Core", function () {
  let owner: Signer, treasury: Signer, agent: Signer, merchant: Signer;
  let msecco: MSECCOToken, passport: AgentPassport, core: AiFinPayCore, splitter: any;

  beforeEach(async function () {
    const contracts = await loadFixture(fixture);
    owner = contracts.owner;
    treasury = contracts.treasury;
    agent = contracts.agent;
    merchant = contracts.merchant;
    msecco = contracts.msecco;
    passport = contracts.passport;
    core = contracts.core;

    const B2BSplitterFactory = await ethers.getContractFactory("B2BSplitter");
    // v1.2: (owner, treasury, usdc, usdt) — per-chain tokens (AIFINP-34).
    splitter = await B2BSplitterFactory.deploy(
      await treasury.getAddress(),
      await treasury.getAddress(),
      "0x1000000000000000000000000000000000000001",
      "0x1000000000000000000000000000000000000002"
    );
  });

  describe("Splitter Configuration", function () {
    it("splitter has correct owner", async function () {
      expect(await splitter.owner()).to.equal(await treasury.getAddress());
    });

    it("splitter has correct treasury address", async function () {
      expect(await splitter.treasury()).to.equal(await treasury.getAddress());
    });

    it("splitter has correct default fee split", async function () {
      expect(await splitter.treasuryBps()).to.equal(100);
      expect(await splitter.ipCreatorBps()).to.equal(1);
    });

    it("splitter whitelists the per-chain tokens set at deployment (AIFINP-34)", async function () {
      // v1.2: no longer hardcoded Polygon addresses — taken from the constructor.
      expect(await splitter.whitelistedTokens("0x1000000000000000000000000000000000000001")).to.equal(true);
      expect(await splitter.whitelistedTokens("0x1000000000000000000000000000000000000002")).to.equal(true);
    });
  });

  describe("Fee Distribution", function () {
    it("default fees are set correctly", async function () {
      expect(await core.treasuryBps()).to.equal(100);
      expect(await core.ipCreatorBps()).to.equal(1);
    });

    it("fees sum to less than 100%", async function () {
      const total = await core.treasuryBps() + await core.ipCreatorBps();
      expect(total).to.be.lessThan(10000);
    });
  });
});