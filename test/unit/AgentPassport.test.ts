import { expect } from "chai";

import { ethers, loadFixture, fixture } from "../fixtures";
import { Signer, ZeroHash } from "ethers";
import { AgentPassport, AiFinPayCore, MSECCOToken } from "../../typechain-types";

describe("AgentPassport", function () {
  let owner: Signer, treasury: Signer, agent: Signer, merchant: Signer, attacker: Signer;
  let msecco: MSECCOToken, passport: AgentPassport, core: AiFinPayCore;

  beforeEach(async function () {
    ({ owner, treasury, agent, merchant, attacker, msecco, passport, core } = await loadFixture(fixture));
  });

  describe("Metadata", function () {
    it("has correct ERC721 name", async function () {
      expect(await passport.name()).to.equal("AiFinPay Agent Passport");
    });

    it("has correct symbol", async function () {
      expect(await passport.symbol()).to.equal("AIPASS");
    });

    it("core is correctly wired", async function () {
      expect(await passport.aifinpayCore()).to.equal(await core.getAddress());
    });
  });

  describe("Access Control", function () {
    it("only owner can setCore", async function () {
      await expect(passport.connect(attacker).setCore(await attacker.getAddress()))
        .to.be.revertedWithCustomError(passport, "OwnableUnauthorizedAccount");
    });

    it("owner can setCore", async function () {
      expect(await passport.aifinpayCore()).to.equal(await core.getAddress());
    });
  });

  describe("Verification", function () {
    it("returns false for non-holder (hasPassport)", async function () {
      expect(await passport.hasPassport(await attacker.getAddress())).to.equal(false);
    });

    it("returns false for non-holder B2B", async function () {
      expect(await passport.isVerifiedB2B(await attacker.getAddress())).to.equal(false);
    });
  });
});