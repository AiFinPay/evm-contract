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

describe("Integration: B2BSplitterV13 release profile", function () {
  let treasury: Signer;
  let splitter: any;

  beforeEach(async function () {
    const contracts = await loadFixture(fixture);
    treasury = contracts.treasury;

    const factory = await ethers.getContractFactory("B2BSplitterV13");
    splitter = await factory.deploy(
      await treasury.getAddress(),
      await treasury.getAddress(),
      "0x1000000000000000000000000000000000000001",
      "0x1000000000000000000000000000000000000002",
      100,
      0,
    );
  });

  it("has the approved AIFP-1 immutable 100/0 profile", async function () {
    expect(await splitter.owner()).to.equal(await treasury.getAddress());
    expect(await splitter.treasury()).to.equal(await treasury.getAddress());
    expect(await splitter.treasuryBps()).to.equal(100);
    expect(await splitter.ipCreatorBps()).to.equal(0);
  });

  it("uses only constructor-pinned stable token addresses", async function () {
    expect(await splitter.USDC()).to.equal("0x1000000000000000000000000000000000000001");
    expect(await splitter.USDT()).to.equal("0x1000000000000000000000000000000000000002");
  });

  it("does not expose the retired mutable setSplit selector", async function () {
    const fn = splitter.interface.fragments.find((fragment: any) => fragment.type === "function" && fragment.name === "setSplit");
    expect(fn).to.equal(undefined);
  });
});
