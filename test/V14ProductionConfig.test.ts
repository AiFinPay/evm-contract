import { expect } from "chai";
import { ZeroAddress } from "ethers";
import { configuredStableAddress, configuredStablecoins } from "../config/v14-production-config.js";

describe("v1.4 production asset configuration", () => {
  it("does not mislabel Polygon bridged USDC as USDT", () => {
    const assets = configuredStablecoins(137);
    expect(assets.map((asset) => asset.symbol)).to.deep.equal(["USDC", "USDC.e"]);
    expect(configuredStableAddress(137, "USDT")).to.equal(ZeroAddress);
  });

  it("returns all Robinhood assets instead of assuming USDC/USDT", () => {
    const assets = configuredStablecoins(4663);
    expect(assets.map((asset) => asset.symbol)).to.deep.equal(["USDe", "USDG"]);
    expect(assets.every((asset) => asset.address !== ZeroAddress)).to.equal(true);
  });

  it("hard-disables BOT Chain for v1.4 deployment", () => {
    expect(() => configuredStablecoins(677)).to.throw("Unsupported AiFinPay v1.4 chainId 677");
  });
});
