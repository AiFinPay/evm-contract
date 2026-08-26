import { expect } from "chai";

import { ethers, loadFixture, fixture } from "../fixtures";
import { Signer } from "ethers";

describe("E2E: Agent Payment Flow", function () {
  let owner: Signer, treasury: Signer, agent: Signer, merchant: Signer, ipCreator: Signer;
  let core: any, msecco: any, passport: any;

  beforeEach(async function () {
    const contracts = await loadFixture(fixture);
    owner = contracts.owner;
    treasury = contracts.treasury;
    agent = contracts.agent;
    merchant = contracts.merchant;
    ipCreator = contracts.ipCreator;
    core = contracts.core;
    msecco = contracts.msecco;
    passport = contracts.passport;
  });

  describe("Scenario 1: Partner Management", function () {
    it("partner can be registered and verified", async function () {
      await core.connect(owner).registerPartner(await merchant.getAddress(), "Coffee Shop");

      const partnerBefore = await core.partners(await merchant.getAddress());
      expect(partnerBefore.active).to.equal(true);
    });

    it("partner can be deactivated", async function () {
      await core.connect(owner).registerPartner(await merchant.getAddress(), "Coffee Shop");
      await core.connect(owner).deactivatePartner(await merchant.getAddress());

      const partnerAfter = await core.partners(await merchant.getAddress());
      expect(partnerAfter.active).to.equal(false);
    });

    it("cannot register zero address partner", async function () {
      await expect(core.connect(owner).registerPartner(ethers.ZeroAddress, "Test"))
        .to.be.revertedWithCustomError(core, "ZeroPartner");
    });

    it("cannot register empty partner name", async function () {
      await expect(core.connect(owner).registerPartner(await merchant.getAddress(), ""))
        .to.be.revertedWithCustomError(core, "EmptyPartnerName");
    });
  });

  describe("Scenario 2: Protocol Pause and Resume", function () {
    it("admin can pause and resume protocol", async function () {
      await core.connect(owner).pause();
      expect(await core.isPaused()).to.equal(true);

      await core.connect(owner).unpause();
      expect(await core.isPaused()).to.equal(false);
    });

    it("non-owner cannot pause", async function () {
      await expect(core.connect(agent).pause())
        .to.be.revertedWithCustomError(core, "OwnableUnauthorizedAccount");
    });
  });

  describe("Scenario 3: Fee Configuration", function () {
    it("owner can adjust protocol fees", async function () {
      await core.connect(owner).setFees(200, 10);

      expect(await core.treasuryBps()).to.equal(200);
      expect(await core.ipCreatorBps()).to.equal(10);
    });

    it("fees cannot exceed 100%", async function () {
      await expect(core.connect(owner).setFees(10000, 0))
        .to.be.revertedWithCustomError(core, "FeesExceed100");

      await expect(core.connect(owner).setFees(0, 10000))
        .to.be.revertedWithCustomError(core, "FeesExceed100");
    });
  });

  describe("Scenario 4: Treasury Operations", function () {
    it("treasury address can be changed", async function () {
      const newTreasury = (await ethers.getSigners())[10];

      await core.connect(owner).setTreasury(await newTreasury.getAddress());
      expect(await core.treasury()).to.equal(await newTreasury.getAddress());
    });

    it("treasury cannot be set to zero", async function () {
      await expect(core.connect(owner).setTreasury(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(core, "ZeroTreasury");
    });
  });
});

describe("E2E: Full User Journey", function () {
  let owner: Signer, treasury: Signer, agent: Signer, merchant: Signer, ipCreator: Signer;
  let core: any, msecco: any, passport: any;

  beforeEach(async function () {
    const contracts = await loadFixture(fixture);
    owner = contracts.owner;
    treasury = contracts.treasury;
    agent = contracts.agent;
    merchant = contracts.merchant;
    ipCreator = contracts.ipCreator;
    core = contracts.core;
    msecco = contracts.msecco;
    passport = contracts.passport;
  });

  describe("Protocol Configuration", function () {
    it("manifestoHash is set to the real canonical hash", async function () {
      expect(await core.manifestoHash()).to.equal(
        "0x27b28e3044b56df3332a60c27604686a634f922a184f62398a4e2f85df19c699"
      );
    });

    it("default treasury fee is 1%", async function () {
      expect(await core.treasuryBps()).to.equal(100);
    });

    it("default IP creator fee is 0.01%", async function () {
      expect(await core.ipCreatorBps()).to.equal(1);
    });

    it("MIN_USD_CENTS is 10", async function () {
      expect(await core.MIN_USD_CENTS()).to.equal(10);
    });

    it("PYTH_MAX_AGE is 60 seconds", async function () {
      expect(await core.PYTH_MAX_AGE()).to.equal(60);
    });
  });

  describe("Token Whitelist", function () {
    it("initial stablecoins are whitelisted from constructor", async function () {
      expect(await core.whitelistedTokens("0x1000000000000000000000000000000000000001")).to.equal(true);
      expect(await core.whitelistedTokens("0x1000000000000000000000000000000000000002")).to.equal(true);
    });

    it("owner can add and remove a token from the whitelist", async function () {
      const token = "0x3333333333333333333333333333333333333333";
      await expect(core.connect(owner).setWhitelistedTokens([token], [true]))
        .to.emit(core, "WhitelistedTokensUpdated")
        .withArgs([token], [true]);
      expect(await core.whitelistedTokens(token)).to.equal(true);

      await expect(core.connect(owner).setWhitelistedTokens([token], [false]))
        .to.emit(core, "WhitelistedTokensUpdated")
        .withArgs([token], [false]);
      expect(await core.whitelistedTokens(token)).to.equal(false);
    });

    it("non-owner cannot update the whitelist", async function () {
      const { attacker: nonOwner } = await loadFixture(fixture);
      const token = "0x3333333333333333333333333333333333333333";
      await expect(core.connect(nonOwner).setWhitelistedTokens([token], [true]))
        .to.be.revertedWithCustomError(core, "OwnableUnauthorizedAccount");
    });

    it("Pyth contract is set from constructor", async function () {
      expect(await core.PYTH()).to.not.equal(ethers.ZeroAddress);
    });
  });

  describe("mSECCO State", function () {
    it("total supply remains zero initially", async function () {
      expect(await msecco.totalSupply()).to.equal(0n);
    });

    it("name is mSECCO", async function () {
      expect(await msecco.name()).to.equal("mSECCO");
    });

    it("symbol is mSECCO", async function () {
      expect(await msecco.symbol()).to.equal("mSECCO");
    });

    it("decimals is 2", async function () {
      expect(await msecco.decimals()).to.equal(2);
    });
  });

  describe("Passport State", function () {
    it("name is AiFinPay Agent Passport", async function () {
      expect(await passport.name()).to.equal("AiFinPay Agent Passport");
    });

    it("symbol is AIPASS", async function () {
      expect(await passport.symbol()).to.equal("AIPASS");
    });

    it("core is correctly wired", async function () {
      expect(await passport.aifinpayCore()).to.equal(await core.getAddress());
    });
  });
});