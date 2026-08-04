import { expect } from "chai";
import { ethers } from "hardhat";
import { DeploymentManifest, validateManifest, verifyDeployment } from "../../scripts/verify-deployment";

describe("Deployment verifier", function () {
  async function deployedManifest(): Promise<DeploymentManifest> {
    const [deployer] = await ethers.getSigners();
    const MockPyth = await ethers.getContractFactory("MockPyth");
    const governance = await MockPyth.deploy();
    const MSECCO = await ethers.getContractFactory("MSECCOToken");
    const Passport = await ethers.getContractFactory("AgentPassport");
    const Core = await ethers.getContractFactory("AiFinPayCore");
    const msecco = await MSECCO.deploy(deployer.address);
    const passport = await Passport.deploy(deployer.address);
    const governanceAddress = await governance.getAddress();
    const nativeUsdId = "0x5de33a9112c2b700b8d30b8a3402c103578ccfa2856a12a2b20d7b0c67b6d82d";
    const core = await Core.deploy(
      governanceAddress,
      await msecco.getAddress(),
      await passport.getAddress(),
      governanceAddress,
      governanceAddress,
      governanceAddress,
      governanceAddress,
      nativeUsdId
    );
    await (await msecco.setCore(await core.getAddress())).wait();
    await (await passport.setCore(await core.getAddress())).wait();
    await (await msecco.transferOwnership(governanceAddress)).wait();
    await (await passport.transferOwnership(governanceAddress)).wait();

    return {
      schemaVersion: 1,
      network: "hardhat",
      chainId: 31337,
      contracts: {
        msecco: await msecco.getAddress(),
        passport: await passport.getAddress(),
        core: await core.getAddress(),
      },
      expected: {
        owner: governanceAddress,
        treasury: governanceAddress,
        pyth: governanceAddress,
        usdc: governanceAddress,
        usdt: governanceAddress,
        nativeUsdId,
        paused: false,
        treasuryBps: 100,
        ipCreatorBps: 1,
      },
    };
  }

  it("accepts a fully deployed, wired and governed contract set", async function () {
    await verifyDeployment(ethers.provider, await deployedManifest());
  });

  it("fails closed on a treasury mismatch", async function () {
    const manifest = await deployedManifest();
    manifest.expected.treasury = (await ethers.getSigners())[1].address;
    await expect(verifyDeployment(ethers.provider, manifest)).to.be.rejectedWith(
      "treasury"
    );
  });

  it("rejects placeholders and zero addresses before RPC verification", function () {
    expect(() =>
      validateManifest({
        schemaVersion: 1,
        network: "polygon",
        chainId: 137,
        contracts: { msecco: "PENDING", passport: ethers.ZeroAddress, core: "" },
        expected: {},
      })
    ).to.throw("non-zero address");
  });

  it("fails closed when the manifest chain does not match the provider", async function () {
    const manifest = await deployedManifest();
    manifest.chainId = 137;
    await expect(verifyDeployment(ethers.provider, manifest)).to.be.rejectedWith(
      "chainId"
    );
  });
});
