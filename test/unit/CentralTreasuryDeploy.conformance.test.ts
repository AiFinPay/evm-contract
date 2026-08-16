import { expect } from "chai";
import { readFileSync } from "node:fs";
import { describe, it } from "mocha";

const source = readFileSync(new URL("../../scripts/deploy-splitter-v13-central-treasury.ts", import.meta.url), "utf8");

describe("central treasury deployment source conformance", () => {
  it("keeps governance Safe and operational collector as separate controls", () => {
    expect(source).to.include('governanceEnv(chainId)');
    expect(source).to.include('inspectSafe(ethers.provider, "Governance Safe"');
    expect(source).to.include('requiredAddress("AIFINPAY_TREASURY_COLLECTOR_EVM")');
    expect(source).to.include('Operational treasury collector must not be the deployment EOA');
  });

  it("independently verifies one central Base Safe with a safe threshold", () => {
    expect(source).to.include('requiredAddress("AIFINPAY_CENTRAL_TREASURY_SAFE_BASE")');
    expect(source).to.include('verifyCentralBaseSafe(centralSafeAddress)');
    expect(source).to.include('owners.length < 2');
    expect(source).to.include('threshold < 2');
    expect(source).to.include('BASE_CHAIN_ID = 8453');
    expect(source).to.include('BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"');
  });

  it("preserves canonical immutable route profiles and disabled deployment evidence", () => {
    expect(source).to.include('"agent-x402": { treasuryBps: 0, ipCreatorBps: 0 }');
    expect(source).to.include('"merchant-aifp1": { treasuryBps: 100, ipCreatorBps: 0 }');
    expect(source).to.include('status: "DEPLOYED_DISABLED"');
    expect(source).to.include('settlementEnabled: false');
    expect(source).to.include('e2eVerified: false');
    expect(source).to.include('sweepExecution: "ASYNC_AFTER_SETTLEMENT"');
  });

  it("requires an explicit central-treasury mainnet confirmation", () => {
    expect(source).to.include('CONFIRM_MAINNET_DEPLOY !== `${chainId}:${profileName}:central-treasury`');
  });
});
