import { expect } from "chai";

import { ethers, loadFixture, fixture } from "../fixtures";
import { Signer, parseEther } from "ethers";
import { AgentPassport, AiFinPayCore, MockPyth, MSECCOToken } from "../../typechain-types";

describe("AiFinPayCore", function () {
  let owner: Signer, treasury: Signer, agent: Signer, merchant: Signer, attacker: Signer;
  let msecco: MSECCOToken, passport: AgentPassport, core: AiFinPayCore, mockPyth: MockPyth;
  let usdcToken: any, usdtToken: any;

  beforeEach(async function () {
    ({ owner, treasury, agent, merchant, attacker, msecco, passport, core, mockPyth, usdcToken, usdtToken } = await loadFixture(fixture));
  });

  describe("Configuration", function () {
    it("manifestoHash defaults to the real canonical hash", async function () {
      expect(await core.manifestoHash()).to.equal(
        "0x27b28e3044b56df3332a60c27604686a634f922a184f62398a4e2f85df19c699"
      );
    });

    it("owner (Safe) can update manifestoHash, non-owner cannot", async function () {
      const newHash = "0x1111111111111111111111111111111111111111111111111111111111111111";
      await expect(core.connect(attacker).setManifestoHash(newHash)).to.revert(ethers);
      await expect(core.connect(owner).setManifestoHash(newHash))
        .to.emit(core, "ManifestoHashUpdated");
      expect(await core.manifestoHash()).to.equal(newHash);
    });

    it("reserveSeatStable reverts when the agreement hash is wrong", async function () {
      const wrongHash = "0x2222222222222222222222222222222222222222222222222222222222222222";
      await expect(
        core.connect(agent).reserveSeatStable(wrongHash, "0x1000000000000000000000000000000000000001", 1_000_000, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(core, "InvalidAgreementHash");
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

    it("initial stablecoins are whitelisted from constructor", async function () {
      expect(await core.whitelistedTokens(await usdcToken.getAddress())).to.equal(true);
      expect(await core.whitelistedTokens(await usdtToken.getAddress())).to.equal(true);
    });

    it("non-whitelisted stablecoin reverts reserveSeatStable", async function () {
      const hash = "0x27b28e3044b56df3332a60c27604686a634f922a184f62398a4e2f85df19c699";
      await expect(
        core.connect(agent).reserveSeatStable(hash, "0x3333333333333333333333333333333333333333", 1_000_000, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(core, "UnsupportedToken");
    });

    // AIFINP-120. The divisor used to be a fixed 10_000, i.e. an assumption that
    // every stablecoin has 6 decimals. BNB Chain's Binance-Peg USDC and USDT have
    // 18, so one dollar credited 10^14 cents instead of 100 — a 10^12 over-mint
    // of mSECCO that Core can never burn back. These lock the behaviour in.
    describe("stablecoin decimals (AIFINP-120)", function () {
      const MANIFESTO = "0x27b28e3044b56df3332a60c27604686a634f922a184f62398a4e2f85df19c699";

      async function whitelistedToken(decimals: number) {
        const token = await (await ethers.getContractFactory("MockERC20"))
          .deploy("Pegged", "PEG", decimals);
        await core.connect(owner).setWhitelistedTokens([await token.getAddress()], [true]);
        return token;
      }

      it("divisor is derived from each token's own decimals()", async function () {
        expect(await core.stableCentsDivisor(await usdcToken.getAddress())).to.equal(10n ** 4n);
        const token18 = await whitelistedToken(18);
        expect(await core.stableCentsDivisor(await token18.getAddress())).to.equal(10n ** 16n);
      });

      it("one dollar of an 18-decimal stablecoin credits 100 cents, not 10^14", async function () {
        const token = await whitelistedToken(18);
        const oneDollar = 10n ** 18n;
        const agentAddr = await agent.getAddress();

        await token.mint(agentAddr, oneDollar);
        await token.connect(agent).approve(await core.getAddress(), oneDollar);
        await core.connect(agent).reserveSeatStable(MANIFESTO, await token.getAddress(), oneDollar, ethers.ZeroAddress);

        // mSECCO is minted 1:1 with USD cents, so it is the visible proof.
        expect(await msecco.balanceOf(agentAddr)).to.equal(100n);
      });

      it("a 6-decimal stablecoin still credits the same 100 cents", async function () {
        const oneDollar = 10n ** 6n;
        const agentAddr = await agent.getAddress();

        await usdcToken.mint(agentAddr, oneDollar);
        await usdcToken.connect(agent).approve(await core.getAddress(), oneDollar);
        await core.connect(agent).reserveSeatStable(MANIFESTO, await usdcToken.getAddress(), oneDollar, ethers.ZeroAddress);

        expect(await msecco.balanceOf(agentAddr)).to.equal(100n);
      });

      it("a token that cannot express a whole cent is rejected at whitelist time", async function () {
        const token = await (await ethers.getContractFactory("MockERC20")).deploy("Odd", "ODD", 1);
        await expect(core.connect(owner).setWhitelistedTokens([await token.getAddress()], [true]))
          .to.be.revertedWithCustomError(core, "UnsupportedTokenDecimals");
      });
    });

    it("setWhitelistedTokens reverts on array length mismatch", async function () {
      const token = "0x3333333333333333333333333333333333333333";
      await expect(core.connect(owner).setWhitelistedTokens([token], [true, false]))
        .to.be.revertedWithCustomError(core, "ArrayLengthMismatch");
    });

    it("setWhitelistedTokens reverts on zero address", async function () {
      await expect(core.connect(owner).setWhitelistedTokens([ethers.ZeroAddress], [true]))
        .to.be.revertedWithCustomError(core, "ZeroAddress");
    });

    it("Pyth contract is set from constructor", async function () {
      expect(await core.PYTH()).to.equal(await mockPyth.getAddress());
    });

    it("NATIVE_USD_ID feed ID is set", async function () {
      expect(await core.NATIVE_USD_ID()).to.equal(
        "0x5de33a9112c2b700b8d30b8a3402c103578ccfa2856a12a2b20d7b0c67b6d82d"
      );
    });
  });

  describe("Admin Functions", function () {
    it("owner can pause and unpause", async function () {
      await core.connect(owner).pause();
      expect(await core.isPaused()).to.equal(true);

      await core.connect(owner).unpause();
      expect(await core.isPaused()).to.equal(false);
    });

    it("non-owner cannot pause", async function () {
      await expect(core.connect(attacker).pause())
        .to.be.revertedWithCustomError(core, "OwnableUnauthorizedAccount");
    });

    it("owner can update fees", async function () {
      await core.connect(owner).setFees(200, 5);
      expect(await core.treasuryBps()).to.equal(200);
      expect(await core.ipCreatorBps()).to.equal(5);
    });

    it("fees cannot exceed 100%", async function () {
      await expect(core.connect(owner).setFees(9999, 9999))
        .to.be.revertedWithCustomError(core, "FeesExceed100");
    });

    it("owner can update treasury address", async function () {
      await core.connect(owner).setTreasury(await attacker.getAddress());
      expect(await core.treasury()).to.equal(await attacker.getAddress());
    });

    it("setTreasury reverts on zero address", async function () {
      await expect(core.connect(owner).setTreasury(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(core, "ZeroTreasury");
    });
  });

  describe("Partner Management", function () {
    it("owner can register partner", async function () {
      await core.connect(owner).registerPartner(await merchant.getAddress(), "TestMerchant");
      const partner = await core.partners(await merchant.getAddress());
      expect(partner.active).to.equal(true);
    });

    it("owner can deactivate partner", async function () {
      await core.connect(owner).registerPartner(await merchant.getAddress(), "Merchant");
      await core.connect(owner).deactivatePartner(await merchant.getAddress());
      expect((await core.partners(await merchant.getAddress())).active).to.equal(false);
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

  describe("Pyth Oracle Integration", function () {
    it("no fake price can be injected — price comes from oracle not caller", async function () {
      const fragment = core.interface.getFunction("reserveSeatNative");
      const paramNames = fragment.inputs.map(i => i.name);
      expect(paramNames).to.not.include("nativeUsdPrice");
      expect(paramNames).to.include("_priceUpdateData");
    });

    it("topUpNative signature has no nativeUsdPrice parameter", async function () {
      const fragment = core.interface.getFunction("topUpNative");
      const paramNames = fragment.inputs.map(i => i.name);
      expect(paramNames).to.not.include("nativeUsdPrice");
      expect(paramNames).to.include("_priceUpdateData");
    });

    it("usdCents calculation: 1 MATIC @ $0.50 = 50 cents", async function () {
      const maticPayment = parseEther("1");
      const price = 50_000_000n;
      const usdCents = (maticPayment * price) / 1000000000000000000000000n;
      expect(usdCents).to.equal(50n);
    });

    it("usdCents calculation: 0.1 MATIC @ $0.50 = 5 cents", async function () {
      const maticPayment = parseEther("0.1");
      const price = 50_000_000n;
      const usdCents = (maticPayment * price) / 1000000000000000000000000n;
      expect(usdCents).to.equal(5n);
    });
  });

  describe("Pausable Functionality", function () {
    it("owner can pause", async function () {
      await core.connect(owner).pause();
      expect(await core.isPaused()).to.equal(true);
    });

    it("owner can unpause", async function () {
      await core.connect(owner).pause();
      await core.connect(owner).unpause();
      expect(await core.isPaused()).to.equal(false);
    });

    it("pause and unpause emit events", async function () {
      await expect(core.connect(owner).pause())
        .to.emit(core, "Paused")
        .withArgs(true);

      await expect(core.connect(owner).unpause())
        .to.emit(core, "Paused")
        .withArgs(false);
    });
  });
});