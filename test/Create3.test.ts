import { expect } from "chai";
import { ethers } from "./fixtures";
import {
  canonicalSalt,
  deployDirect,
  deployViaCreate3,
  predictCreate3Address,
} from "../scripts/lib/create3";

describe("CREATE3 deployment", () => {
  it("deploys the factory and derives deterministic child addresses", async () => {
    const [deployer] = await ethers.getSigners();
    const deployerAddress = await deployer.getAddress();

    const { address: factoryAddress } = await deployDirect(ethers, "CreateXMock", []);
    expect(await ethers.provider.getCode(factoryAddress)).to.not.equal("0x");

    const salt = canonicalSalt(deployerAddress, "TestContract", "1.0");
    const predicted = await predictCreate3Address(ethers, factoryAddress, deployerAddress, salt);

    const { address } = await deployViaCreate3(ethers, factoryAddress, "TokenList", salt, [
      deployerAddress,
      [],
    ]);

    expect(address).to.equal(predicted);
    expect(await ethers.provider.getCode(address)).to.not.equal("0x");
  });

  it("rejects a second deployment with the same salt", async () => {
    const [deployer] = await ethers.getSigners();
    const deployerAddress = await deployer.getAddress();

    const { address: factoryAddress } = await deployDirect(ethers, "CreateXMock", []);
    const salt = canonicalSalt(deployerAddress, "TokenList", "1.0");

    const { address: deployedA } = await deployViaCreate3(
      ethers,
      factoryAddress,
      "TokenList",
      salt,
      [deployerAddress, []],
    );
    const predicted = await predictCreate3Address(ethers, factoryAddress, deployerAddress, salt);
    expect(deployedA).to.equal(predicted);

    await expect(
      deployViaCreate3(ethers, factoryAddress, "TokenList", salt, [deployerAddress, []]),
    ).to.be.revertedWith("DEPLOYMENT_FAILED");
  });
});
