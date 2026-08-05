import { expect } from "chai";

import { ethers, loadFixture, fixture } from "../fixtures";
import { Signer } from "ethers";
import { AgentPassport, AiFinPayCore, MSECCOToken } from "../../typechain-types";

describe("MSECCOToken", function () {
  let owner: Signer, treasury: Signer, agent: Signer, merchant: Signer, ipCreator: Signer, attacker: Signer;
  let msecco: MSECCOToken, passport: AgentPassport, core: AiFinPayCore;

  beforeEach(async function () {
    ({ owner, treasury, agent, merchant, ipCreator, attacker, msecco, passport, core } = await loadFixture(fixture));
  });

  describe("Metadata", function () {
    it("has correct name", async function () {
      expect(await msecco.name()).to.equal("mSECCO");
    });

    it("has correct symbol", async function () {
      expect(await msecco.symbol()).to.equal("mSECCO");
    });

    it("has correct decimals (2)", async function () {
      expect(await msecco.decimals()).to.equal(2);
    });

    it("core is correctly wired", async function () {
      expect(await msecco.aifinpayCore()).to.equal(await core.getAddress());
    });
  });

  describe("Core Access Control", function () {
    it("non-core cannot mint", async function () {
      await expect(msecco.connect(attacker).mint(await attacker.getAddress(), 100))
        .to.be.revertedWithCustomError(msecco, "OnlyCore");
    });

    it("owner cannot mint (not core)", async function () {
      await expect(msecco.connect(owner).mint(await owner.getAddress(), 100))
        .to.be.revertedWithCustomError(msecco, "OnlyCore");
    });

    it("non-core cannot burn", async function () {
      await expect(msecco.connect(attacker).burn(await attacker.getAddress(), 100))
        .to.be.revertedWithCustomError(msecco, "OnlyCore");
    });

    it("owner cannot burn (not core)", async function () {
      await expect(msecco.connect(owner).burn(await owner.getAddress(), 100))
        .to.be.revertedWithCustomError(msecco, "OnlyCore");
    });

    it("only owner can call setCore", async function () {
      const MSECCOToken = await ethers.getContractFactory("MSECCOToken");
      const newMsecco = (await MSECCOToken.deploy(await owner.getAddress())) as unknown as MSECCOToken;

      await expect(newMsecco.connect(attacker).setCore(await attacker.getAddress()))
        .to.be.revertedWithCustomError(newMsecco, "OwnableUnauthorizedAccount");
    });
  });

  describe("Transfer Blocking (via _update hook)", function () {
    it("transfer is disabled (non-transferable)", async function () {
      await expect(msecco.transfer(await attacker.getAddress(), 1))
        .to.be.revertedWithCustomError(msecco, "NonTransferable");
    });

    it("transfer blocks with amount of 1", async function () {
      await expect(msecco.transfer(await attacker.getAddress(), 1))
        .to.be.revertedWithCustomError(msecco, "NonTransferable");
    });

    it("transfer blocks with amount of 100", async function () {
      await expect(msecco.transfer(await attacker.getAddress(), 100))
        .to.be.revertedWithCustomError(msecco, "NonTransferable");
    });

    it("transfer blocks with zero amount", async function () {
      await expect(msecco.transfer(await attacker.getAddress(), 0))
        .to.be.revertedWithCustomError(msecco, "NonTransferable");
    });

    it("transfer blocks with max uint256", async function () {
      await expect(msecco.transfer(await attacker.getAddress(), ethers.MaxUint256))
        .to.be.revertedWithCustomError(msecco, "NonTransferable");
    });

    it("transferFrom is blocked (insufficient allowance check happens first)", async function () {
      await expect(
        msecco.transferFrom(await owner.getAddress(), await attacker.getAddress(), 1),
      ).to.be.revertedWithCustomError(msecco, "ERC20InsufficientAllowance");
    });

    it("transferFrom blocks with zero amount", async function () {
      await expect(
        msecco.transferFrom(await owner.getAddress(), await attacker.getAddress(), 0),
      ).to.be.revertedWithCustomError(msecco, "NonTransferable");
    });

    it("transferFrom blocks from owner", async function () {
      const ownerAddr = await owner.getAddress();
      await expect(
        msecco.transferFrom(ownerAddr, await attacker.getAddress(), 100),
      ).to.be.revertedWithCustomError(msecco, "ERC20InsufficientAllowance");
    });

    it("transferFrom blocks from agent", async function () {
      await expect(
        msecco.connect(agent).transferFrom(await agent.getAddress(), await merchant.getAddress(), 100),
      ).to.be.revertedWithCustomError(msecco, "ERC20InsufficientAllowance");
    });

    it("cannot transfer to zero address", async function () {
      await expect(msecco.transfer(ethers.ZeroAddress, 1))
        .to.be.revertedWithCustomError(msecco, "ERC20InvalidReceiver");
    });

    it("cannot transfer to self", async function () {
      const ownerAddr = await owner.getAddress();
      await expect(msecco.transfer(ownerAddr, 1))
        .to.be.revertedWithCustomError(msecco, "NonTransferable");
    });

    it("agent cannot transfer to merchant", async function () {
      await expect(msecco.connect(agent).transfer(await merchant.getAddress(), 1000))
        .to.be.revertedWithCustomError(msecco, "NonTransferable");
    });

    it("merchant cannot transfer to agent", async function () {
      await expect(msecco.connect(merchant).transfer(await agent.getAddress(), 1000))
        .to.be.revertedWithCustomError(msecco, "NonTransferable");
    });

    it("transfer blocks same sender and recipient (transferFrom)", async function () {
      const ownerAddr = await owner.getAddress();
      await expect(msecco.transferFrom(ownerAddr, ownerAddr, 1))
        .to.be.revertedWithCustomError(msecco, "ERC20InsufficientAllowance");
    });
  });

  describe("Approval Blocking (via _approve hook)", function () {
    it("approve is disabled for amount of 1", async function () {
      await expect(msecco.approve(await attacker.getAddress(), 1))
        .to.be.revertedWithCustomError(msecco, "NonTransferable");
    });

    it("approve blocks amount of 100", async function () {
      await expect(msecco.approve(await attacker.getAddress(), 100))
        .to.be.revertedWithCustomError(msecco, "NonTransferable");
    });

    it("approve blocks large amounts", async function () {
      await expect(msecco.approve(await attacker.getAddress(), ethers.MaxUint256))
        .to.be.revertedWithCustomError(msecco, "NonTransferable");
    });

    it("approve zero amount is allowed", async function () {
      await expect(msecco.approve(await attacker.getAddress(), 0))
        .not.to.revert(ethers);
    });

    it("approve zero amount allows clearing approvals", async function () {
      await expect(msecco.approve(await attacker.getAddress(), 0))
        .not.to.revert(ethers);
    });

    it("agent cannot approve attacker", async function () {
      await expect(msecco.connect(agent).approve(await attacker.getAddress(), 1))
        .to.be.revertedWithCustomError(msecco, "NonTransferable");
    });

    it("merchant cannot approve agent", async function () {
      await expect(msecco.connect(merchant).approve(await agent.getAddress(), 100))
        .to.be.revertedWithCustomError(msecco, "NonTransferable");
    });

    it("cannot approve to self", async function () {
      const ownerAddr = await owner.getAddress();
      await expect(msecco.approve(ownerAddr, 1))
        .to.be.revertedWithCustomError(msecco, "NonTransferable");
    });

    it("cannot approve to zero address with non-zero amount", async function () {
      await expect(msecco.approve(ethers.ZeroAddress, 1))
        .to.be.revertedWithCustomError(msecco, "NonTransferable");
    });

    it("allowance is always zero regardless of address pairs", async function () {
      expect(await msecco.allowance(await owner.getAddress(), await attacker.getAddress())).to.equal(0n);
      expect(await msecco.allowance(await agent.getAddress(), await merchant.getAddress())).to.equal(0n);
      expect(await msecco.allowance(await merchant.getAddress(), await ipCreator.getAddress())).to.equal(0n);
    });
  });

  describe("Core Setup & Configuration", function () {
    it("setCore is one-time only", async function () {
      await expect(msecco.setCore(await attacker.getAddress()))
        .to.be.revertedWithCustomError(msecco, "CoreAlreadySet");
    });

    it("setCore reverts on zero address", async function () {
      const MSECCOToken = await ethers.getContractFactory("MSECCOToken");
      const newMsecco = (await MSECCOToken.deploy(await owner.getAddress())) as unknown as MSECCOToken;

      await expect(newMsecco.connect(owner).setCore(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(newMsecco, "ZeroAddress");
    });

    it("core can be set only once per contract", async function () {
      const MSECCOToken = await ethers.getContractFactory("MSECCOToken");
      const newMsecco = (await MSECCOToken.deploy(await owner.getAddress())) as unknown as MSECCOToken;

      await newMsecco.connect(owner).setCore(await core.getAddress());
      expect(await newMsecco.aifinpayCore()).to.equal(await core.getAddress());

      await expect(newMsecco.connect(owner).setCore(await attacker.getAddress()))
        .to.be.revertedWithCustomError(newMsecco, "CoreAlreadySet");
    });

    it("core address is immutable after setCore", async function () {
      const coreAddr = await msecco.aifinpayCore();
      expect(coreAddr).to.equal(await core.getAddress());

      await expect(msecco.setCore(await attacker.getAddress()))
        .to.be.revertedWithCustomError(msecco, "CoreAlreadySet");

      expect(await msecco.aifinpayCore()).to.equal(coreAddr);
    });
  });

  describe("ERC20 Standard Compatibility", function () {
    it("transfer function exists with correct signature", async function () {
      const fragment = msecco.interface.getFunction("transfer");
      expect(fragment).to.not.be.undefined;
      expect(fragment?.inputs.length).to.equal(2);
      expect(fragment?.inputs[0].name).to.equal("to");
      expect(fragment?.inputs[1].name).to.equal("value");
    });

    it("transferFrom function exists with correct signature", async function () {
      const fragment = msecco.interface.getFunction("transferFrom");
      expect(fragment).to.not.be.undefined;
      expect(fragment?.inputs.length).to.equal(3);
    });

    it("approve function exists with correct signature", async function () {
      const fragment = msecco.interface.getFunction("approve");
      expect(fragment).to.not.be.undefined;
      expect(fragment?.inputs.length).to.equal(2);
    });

    it("mint function exists with correct signature", async function () {
      const fragment = msecco.interface.getFunction("mint");
      expect(fragment).to.not.be.undefined;
    });

    it("burn function exists with correct signature", async function () {
      const fragment = msecco.interface.getFunction("burn");
      expect(fragment).to.not.be.undefined;
    });

    it("balanceOf function exists", async function () {
      const fragment = msecco.interface.getFunction("balanceOf");
      expect(fragment).to.not.be.undefined;
    });

    it("allowance function exists", async function () {
      const fragment = msecco.interface.getFunction("allowance");
      expect(fragment).to.not.be.undefined;
    });

    it("totalSupply function exists", async function () {
      const fragment = msecco.interface.getFunction("totalSupply");
      expect(fragment).to.not.be.undefined;
    });
  });

  describe("Hook Implementation Details", function () {
    it("_approve hook rejects non-zero amounts", async function () {
      await expect(msecco.approve(await merchant.getAddress(), 1))
        .to.be.revertedWithCustomError(msecco, "NonTransferable");
    });

    it("_approve hook allows zero amounts", async function () {
      await expect(msecco.approve(await merchant.getAddress(), 0))
        .not.to.revert(ethers);
    });

    it("_update hook blocks peer-to-peer transfers", async function () {
      await expect(
        msecco.connect(agent).transfer(await merchant.getAddress(), 100)
      ).to.be.revertedWithCustomError(msecco, "NonTransferable");
    });

    it("hooks enforce non-transferable semantics consistently", async function () {
      for (let i = 0; i < 3; i++) {
        await expect(msecco.transfer(await attacker.getAddress(), 1))
          .to.be.revertedWithCustomError(msecco, "NonTransferable");
      }
    });
  });

  describe("Security Edge Cases", function () {
    it("cannot create circular approvals", async function () {
      await expect(msecco.approve(await msecco.getAddress(), 1))
        .to.be.revertedWithCustomError(msecco, "NonTransferable");
    });

    it("cannot approve self with non-zero amount", async function () {
      const agentAddr = await agent.getAddress();
      await expect(msecco.connect(agent).approve(agentAddr, 1))
        .to.be.revertedWithCustomError(msecco, "NonTransferable");
    });

    it("cannot transfer to self with non-zero amount", async function () {
      const agentAddr = await agent.getAddress();
      await expect(msecco.connect(agent).transfer(agentAddr, 1))
        .to.be.revertedWithCustomError(msecco, "NonTransferable");
    });

    it("cannot transfer zero to self (still blocked)", async function () {
      const agentAddr = await agent.getAddress();
      await expect(msecco.connect(agent).transfer(agentAddr, 0))
        .to.be.revertedWithCustomError(msecco, "NonTransferable");
    });

    it("cannot bypass transfer block via transferFrom", async function () {
      const ownerAddr = await owner.getAddress();
      const agentAddr = await agent.getAddress();

      await expect(msecco.transferFrom(ownerAddr, agentAddr, 1))
        .to.be.revertedWithCustomError(msecco, "ERC20InsufficientAllowance");

      await expect(msecco.connect(agent).transferFrom(ownerAddr, agentAddr, 1))
        .to.be.revertedWithCustomError(msecco, "ERC20InsufficientAllowance");
    });

    it("supply invariant maintained despite transfer attempts", async function () {
      const initialSupply = await msecco.totalSupply();

      await expect(msecco.transfer(await agent.getAddress(), 1))
        .to.be.revertedWithCustomError(msecco, "NonTransferable");

      await expect(msecco.connect(agent).transfer(await merchant.getAddress(), 1))
        .to.be.revertedWithCustomError(msecco, "NonTransferable");

      expect(await msecco.totalSupply()).to.equal(initialSupply);
    });
  });

  describe("Comprehensive Failure Scenarios", function () {
    const amounts = [0n, 1n, 10n, 100n, 1000n, ethers.MaxUint256];

    it("transfer fails for all amounts", async function () {
      for (const amount of amounts) {
        if (amount > 0n) {
          await expect(msecco.transfer(await attacker.getAddress(), amount))
            .to.be.revertedWithCustomError(msecco, "NonTransferable");
        }
      }
    });

    it("approve fails for all non-zero amounts", async function () {
      for (const amount of amounts) {
        if (amount > 0n) {
          await expect(msecco.approve(await attacker.getAddress(), amount))
            .to.be.revertedWithCustomError(msecco, "NonTransferable");
        }
      }
    });

    it("approve succeeds only for zero amount", async function () {
      await expect(msecco.approve(await attacker.getAddress(), 0))
        .not.to.revert(ethers);
    });

    it("transferFrom fails for all non-zero amounts", async function () {
      const ownerAddr = await owner.getAddress();
      const agentAddr = await agent.getAddress();

      for (const amount of [1n, 10n, 100n]) {
        await expect(msecco.transferFrom(ownerAddr, agentAddr, amount))
          .to.be.revertedWithCustomError(msecco, "ERC20InsufficientAllowance");
      }
    });
  });

  describe("Token Identity", function () {
    it("name is immutable", async function () {
      const name1 = await msecco.name();
      const name2 = await msecco.name();
      expect(name1).to.equal(name2);
      expect(name1).to.equal("mSECCO");
    });

    it("symbol is immutable", async function () {
      const symbol1 = await msecco.symbol();
      const symbol2 = await msecco.symbol();
      expect(symbol1).to.equal(symbol2);
      expect(symbol1).to.equal("mSECCO");
    });

    it("decimals is immutable", async function () {
      const decimals1 = await msecco.decimals();
      const decimals2 = await msecco.decimals();
      expect(decimals1).to.equal(decimals2);
      expect(decimals1).to.equal(2);
    });
  });
});