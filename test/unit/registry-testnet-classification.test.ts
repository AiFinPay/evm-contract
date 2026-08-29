import { expect } from "chai";

/**
 * The testnet exemption must be impossible to claim for a mainnet route.
 *
 * Registering a testnet deployment means skipping two gates that exist because
 * a mainnet route moves real money: the governance-Safe owner requirement and
 * the two-independent-provider rule. Skipping them is right for Amoy and
 * catastrophic for Polygon, so the difference cannot rest on a boolean anyone
 * can write into an entry.
 *
 * These tests pin both directions of that. They matter more than the feature:
 * without the second one, a testnet deployment could be registered as
 * production and inherit trust it never earned.
 */
describe("registry: what counts as a testnet", function () {
  let classifyNetwork: any;
  let TESTNET_CHAIN_IDS: any;

  before(async function () {
    // The scripts are ESM; import them the same way the scripts do.
    const mod = await import("../../scripts/lib/testnet.mjs");
    classifyNetwork = mod.classifyNetwork;
    TESTNET_CHAIN_IDS = mod.TESTNET_CHAIN_IDS;
  });

  it("accepts a mainnet route that does not claim to be a testnet", function () {
    const r = classifyNetwork({ chainId: 137 });
    expect(r.ok).to.equal(true);
    expect(r.testnet).to.equal(false);
  });

  it("REFUSES testnet: true on a mainnet chain", function () {
    // The attack this exists to stop: write one field, skip the Safe-owner
    // requirement and the two-provider rule on a route that moves real money.
    const r = classifyNetwork({ chainId: 137, testnet: true });
    expect(r.ok).to.equal(false);
    expect(r.reason).to.match(/not a known testnet/);
  });

  it("REFUSES a testnet chain that does not declare itself", function () {
    // The mirror, and just as important: a testnet deployment slipped in
    // without the flag reads as production and inherits a mainnet route's
    // trust — including being eligible for settlement with a deployer-key
    // owner, which is precisely what the gates forbid.
    const r = classifyNetwork({ chainId: 80002 });
    expect(r.ok).to.equal(false);
    expect(r.reason).to.match(/must say so|does not declare|testnet: true/);
  });

  it("accepts a declared testnet on a known testnet chain", function () {
    const r = classifyNetwork({ chainId: 80002, testnet: true });
    expect(r.ok).to.equal(true);
    expect(r.testnet).to.equal(true);
  });

  it("keeps the testnet set closed and small", function () {
    // Adding a chain here is a reviewed change. If this grows silently,
    // something has widened the exemption without anyone deciding to.
    expect(Object.keys(TESTNET_CHAIN_IDS)).to.deep.equal(["80002"]);
    expect(TESTNET_CHAIN_IDS[80002]).to.equal("amoy");
  });

  it("treats a string chain id the same as a number", function () {
    // JSON is JSON. A quoted chain id must not become an accidental exemption.
    expect(classifyNetwork({ chainId: "137", testnet: true }).ok).to.equal(false);
    expect(classifyNetwork({ chainId: "80002", testnet: true }).ok).to.equal(true);
  });
});
