import { expect } from "chai";
import { ethers, loadFixture } from "../v14-fixtures";
import type { V14Fixture } from "../v14-fixtures";

const ONE_USDC = 1_000_000n;
const BPS_DENOMINATOR = 10_000n;

async function deadline(offset = 3600) {
    const block = await ethers.provider.getBlock("latest");
    return BigInt((block?.timestamp || Math.floor(Date.now() / 1000)) + offset);
}

async function buildQuote(fixture: V14Fixture, overrides: Record<string, any> = {}) {
    const { agent, merchant, usdc, routeIdAgent } = fixture;
    return {
        payer: overrides.payer ?? (await agent.getAddress()),
        merchant: overrides.merchant ?? (await merchant.getAddress()),
        token: overrides.token ?? ethers.ZeroAddress,
        grossAmount: overrides.grossAmount ?? ONE_USDC,
        ipCreator: overrides.ipCreator ?? ethers.ZeroAddress,
        validUntil: overrides.validUntil ?? (await deadline()),
        orderIdHash: overrides.orderIdHash ?? ethers.keccak256(ethers.toUtf8Bytes("order-1")),
        nonce: overrides.nonce ?? 0n,
        routeId: overrides.routeId ?? routeIdAgent,
    };
}

async function signQuote(signer: any, splitter: any, quote: any) {
    const domain = {
        name: "AiFinPayB2BSplitter",
        version: "1",
        chainId: 31337,
        verifyingContract: await splitter.getAddress(),
    };
    const types = {
        Quote: [
            { name: "payer", type: "address" },
            { name: "merchant", type: "address" },
            { name: "token", type: "address" },
            { name: "grossAmount", type: "uint256" },
            { name: "ipCreator", type: "address" },
            { name: "validUntil", type: "uint256" },
            { name: "orderIdHash", type: "bytes32" },
            { name: "nonce", type: "uint256" },
            { name: "routeId", type: "bytes32" },
        ],
    };
    return await signer.signTypedData(domain, types, quote);
}

async function settleNative(fixture: V14Fixture, overrides: Record<string, any> = {}) {
    const { agent, splitter, signer } = fixture;
    const quote = await buildQuote(fixture, overrides);
    const signature = await signQuote(signer, splitter, quote);
    return splitter.connect(agent).settleNative(quote, signature, { value: quote.grossAmount });
}

async function settleStable(fixture: V14Fixture, overrides: Record<string, any> = {}) {
    const { agent, splitter, signer, usdc } = fixture;
    const quote = await buildQuote(fixture, { token: await usdc.getAddress(), ...overrides });
    const signature = await signQuote(signer, splitter, quote);
    await usdc.connect(agent).mint(await agent.getAddress(), quote.grossAmount);
    await usdc.connect(agent).approve(await splitter.getAddress(), quote.grossAmount);
    return splitter.connect(agent).settleStable(quote, signature);
}

describe("B2BSplitter v1.4 — native settlement", () => {
    it("splits AIFP-1 gross 99/1/0 without adding a fee on top", async () => {
        const { splitter, routeIdMerchant } = await loadFixture(deployV14);
        const gross = 10_000n;
        const [merchant, treasury, creator, total] = await splitter.quoteTotal(gross, routeIdMerchant, ethers.ZeroAddress);
        expect([merchant, treasury, creator, total]).to.deep.equal([9_900n, 100n, 0n, 10_000n]);
    });

    it("splits AIFP-2 gross 100/0/0", async () => {
        const { splitter, routeIdAgent } = await loadFixture(deployV14);
        const gross = 10_000n;
        const [merchant, treasury, creator, total] = await splitter.quoteTotal(gross, routeIdAgent, ethers.ZeroAddress);
        expect([merchant, treasury, creator, total]).to.deep.equal([10_000n, 0n, 0n, 10_000n]);
    });

    it("moves exactly gross and leaves no value in the splitter", async () => {
        const fixture = await loadFixture(deployV14);
        const { splitter, treasury, merchant, routeIdMerchant } = fixture;
        const gross = ethers.parseEther("1");
        const [merchantAmt, treasuryAmt] = await splitter.quoteTotal(gross, routeIdMerchant, ethers.ZeroAddress);
        const mb = await ethers.provider.getBalance(await merchant.getAddress());
        const tb = await ethers.provider.getBalance(await treasury.getAddress());

        await settleNative(fixture, { grossAmount: gross, routeId: routeIdMerchant });

        expect((await ethers.provider.getBalance(await merchant.getAddress())) - mb).to.equal(merchantAmt);
        expect((await ethers.provider.getBalance(await treasury.getAddress())) - tb).to.equal(treasuryAmt);
        expect(await ethers.provider.getBalance(await splitter.getAddress())).to.equal(0n);
    });

    it("requires msg.value to equal gross exactly", async () => {
        const fixture = await loadFixture(deployV14);
        const { splitter, routeIdMerchant } = fixture;
        const gross = ethers.parseEther("1");
        const quote = await buildQuote(fixture, { grossAmount: gross, routeId: routeIdMerchant });
        const signature = await signQuote(fixture.signer, splitter, quote);
        await expect(
            splitter.connect(fixture.agent).settleNative(quote, signature, { value: gross - 1n })
        )
            .to.be.revertedWithCustomError(splitter, "IncorrectNativeValue")
            .withArgs(gross, gross - 1n);
    });

    it("rejects an expired signature", async () => {
        const fixture = await loadFixture(deployV14);
        const { splitter } = fixture;
        const gross = 10_000n;
        const block = await ethers.provider.getBlock("latest");
        const expired = BigInt(block?.timestamp || 1);
        await ethers.provider.send("evm_mine", []);
        await expect(settleNative(fixture, { grossAmount: gross, validUntil: expired })).to.be.revertedWithCustomError(
            splitter,
            "SignatureExpired"
        );
    });

    it("rejects replay of the same nonce", async () => {
        const fixture = await loadFixture(deployV14);
        const { splitter, agent } = fixture;
        const gross = 10_000n;
        await settleNative(fixture, { grossAmount: gross, orderIdHash: ethers.keccak256(ethers.toUtf8Bytes("first")) });
        const quote = await buildQuote(fixture, {
            grossAmount: gross,
            orderIdHash: ethers.keccak256(ethers.toUtf8Bytes("second")),
            nonce: 0n,
        });
        const signature = await signQuote(fixture.signer, splitter, quote);
        await expect(
            splitter.connect(agent).settleNative(quote, signature, { value: gross })
        ).to.be.revertedWithCustomError(splitter, "InvalidNonce");
    });

    it("rejects settlement by non-payer", async () => {
        const fixture = await loadFixture(deployV14);
        const { splitter, attacker } = fixture;
        const gross = 10_000n;
        const quote = await buildQuote(fixture, { grossAmount: gross });
        const signature = await signQuote(fixture.signer, splitter, quote);
        await expect(
            splitter.connect(attacker).settleNative(quote, signature, { value: gross })
        ).to.be.revertedWithCustomError(splitter, "InvalidPayer");
    });

    it("rejects invalid signer", async () => {
        const fixture = await loadFixture(deployV14);
        const { splitter, attacker } = fixture;
        const gross = 10_000n;
        const quote = await buildQuote(fixture, { grossAmount: gross });
        const signature = await signQuote(attacker, splitter, quote);
        await expect(
            splitter.connect(fixture.agent).settleNative(quote, signature, { value: gross })
        ).to.be.revertedWithCustomError(splitter, "InvalidSigner");
    });

    it("rejects an unknown route", async () => {
        const fixture = await loadFixture(deployV14);
        const { splitter, profiles } = fixture;
        const gross = 10_000n;
        const unknownRoute = ethers.keccak256(ethers.toUtf8Bytes("unknown"));
        await expect(settleNative(fixture, { grossAmount: gross, routeId: unknownRoute })).to.be.revertedWithCustomError(
            profiles,
            "UnknownRoute"
        );
    });

    it("rejects a disabled route", async () => {
        const fixture = await loadFixture(deployV14);
        const { splitter, owner, routeIdMerchant } = fixture;
        await splitter.connect(owner).disableRoute(routeIdMerchant);
        const gross = 10_000n;
        await expect(settleNative(fixture, { grossAmount: gross, routeId: routeIdMerchant })).to.be.revertedWithCustomError(
            splitter,
            "RouteDisabled"
        );
    });

    it("rejects stable token on native path", async () => {
        const fixture = await loadFixture(deployV14);
        const { splitter, usdc, routeIdAgent } = fixture;
        const gross = 10_000n;
        await expect(
            settleNative(fixture, { grossAmount: gross, token: await usdc.getAddress(), routeId: routeIdAgent })
        ).to.be.revertedWithCustomError(splitter, "InvalidTokenForNative");
    });
});

describe("B2BSplitter v1.4 — stable settlement", () => {
    it("splits USDC gross 99/1/0 without adding a fee on top", async () => {
        const fixture = await loadFixture(deployV14);
        const { splitter, merchant, treasury, routeIdMerchant, usdc } = fixture;
        const gross = ONE_USDC;
        await settleStable(fixture, { grossAmount: gross, routeId: routeIdMerchant });
        expect(await usdc.balanceOf(await merchant.getAddress())).to.equal((gross * 9_900n) / BPS_DENOMINATOR);
        expect(await usdc.balanceOf(await treasury.getAddress())).to.equal((gross * 100n) / BPS_DENOMINATOR);
    });

    it("rejects unsupported token", async () => {
        const fixture = await loadFixture(deployV14);
        const { splitter, agent } = fixture;
        const SomeTokenFactory = await ethers.getContractFactory("MockERC20");
        const rogue = await SomeTokenFactory.deploy("Rogue", "R", 6n);
        await rogue.mint(await agent.getAddress(), ONE_USDC);
        await rogue.approve(await splitter.getAddress(), ONE_USDC);
        const quote = await buildQuote(fixture, { token: await rogue.getAddress(), grossAmount: ONE_USDC });
        const signature = await signQuote(fixture.signer, splitter, quote);
        await expect(splitter.connect(agent).settleStable(quote, signature)).to.be.revertedWithCustomError(
            splitter,
            "UnsupportedToken"
        );
    });

    it("rejects insufficient approval", async () => {
        const fixture = await loadFixture(deployV14);
        const { splitter, agent, usdc } = fixture;
        const quote = await buildQuote(fixture, { token: await usdc.getAddress(), grossAmount: ONE_USDC });
        const signature = await signQuote(fixture.signer, splitter, quote);
        await usdc.mint(await agent.getAddress(), ONE_USDC);
        await usdc.connect(agent).approve(await splitter.getAddress(), ONE_USDC / 2n);
        await expect(splitter.connect(agent).settleStable(quote, signature)).to.revert(ethers);
    });
});

describe("B2BSplitter v1.4 — RBAC", () => {
    it("only admin can pause", async () => {
        const fixture = await loadFixture(deployV14);
        const { splitter, attacker } = fixture;
        await expect(splitter.connect(attacker).pause()).to.be.revertedWithCustomError(
            splitter,
            "AccessControlUnauthorizedAccount"
        );
    });

    it("signer cannot call admin functions", async () => {
        const fixture = await loadFixture(deployV14);
        const { splitter, signer, routeIdAgent } = fixture;
        await expect(
            splitter.connect(signer).configureRoute(routeIdAgent, 0, 0, ethers.ZeroAddress)
        ).to.be.revertedWithCustomError(splitter, "AccessControlUnauthorizedAccount");
        await expect(splitter.connect(signer).pause()).to.be.revertedWithCustomError(
            splitter,
            "AccessControlUnauthorizedAccount"
        );
    });

    it("admin can grant and revoke signer role", async () => {
        const fixture = await loadFixture(deployV14);
        const { splitter, owner, attacker } = fixture;
        const signerRole = await splitter.SIGN_OPERATOR_ROLE();
        await splitter.connect(owner).grantSignerRole(await attacker.getAddress());
        expect(await splitter.hasRole(signerRole, await attacker.getAddress())).to.equal(true);
        await splitter.connect(owner).revokeSignerRole(await attacker.getAddress());
        expect(await splitter.hasRole(signerRole, await attacker.getAddress())).to.equal(false);
    });

    it("constructor enforces admin != signer", async () => {
        const [owner] = await ethers.getSigners();
        const Factory = await ethers.getContractFactory("B2BSplitterV14");
        await expect(
            Factory.deploy({
                initialAdmin: await owner.getAddress(),
                initialSigner: await owner.getAddress(),
                treasury: await owner.getAddress(),
                stablecoins: [ethers.ZeroAddress],
                routeIds: [ethers.keccak256(ethers.toUtf8Bytes("r"))],
                treasuryBps: [0],
                ipCreatorBps: [0],
            })
        ).to.be.revertedWithCustomError(Factory, "AdminEqualsSigner");
    });
});

describe("B2BSplitter v1.4 — route management", () => {
    it("initial routes are configured and enabled", async () => {
        const fixture = await loadFixture(deployV14);
        const { profiles, routeIdAgent, routeIdMerchant } = fixture;
        const agentProfile = await profiles.getProfile(routeIdAgent);
        const merchantProfile = await profiles.getProfile(routeIdMerchant);
        expect(agentProfile.enabled).to.equal(true);
        expect(merchantProfile.enabled).to.equal(true);
        expect(agentProfile.treasuryBps).to.equal(0);
        expect(merchantProfile.treasuryBps).to.equal(100);
    });

    it("admin can add a new route", async () => {
        const fixture = await loadFixture(deployV14);
        const { splitter, owner, profiles } = fixture;
        const newRoute = ethers.keccak256(ethers.toUtf8Bytes("new-route"));
        await splitter.connect(owner).configureRoute(newRoute, 200, 50, ethers.ZeroAddress);
        const profile = await profiles.getProfile(newRoute);
        expect(profile.treasuryBps).to.equal(200);
        expect(profile.ipCreatorBps).to.equal(50);
        expect(profile.enabled).to.equal(true);
    });

    it("rejects route fees above caps", async () => {
        const fixture = await loadFixture(deployV14);
        const { splitter, profiles, owner, routeIdAgent } = fixture;
        await expect(splitter.connect(owner).configureRoute(routeIdAgent, 501, 0, ethers.ZeroAddress))
            .to.be.revertedWithCustomError(profiles, "TreasuryFeeTooHigh");
        await expect(splitter.connect(owner).configureRoute(routeIdAgent, 0, 101, ethers.ZeroAddress))
            .to.be.revertedWithCustomError(profiles, "IPCreatorFeeTooHigh");
    });

    it("profiles routeId helper matches off-chain keccak", async () => {
        const fixture = await loadFixture(deployV14);
        const { profiles, routeIdAgent } = fixture;
        expect(await profiles.routeId("agent-x402")).to.equal(routeIdAgent);
    });
});

// Reference the undeclared helper used by loadFixture to satisfy TypeScript.
async function deployV14(): Promise<V14Fixture> {
    const { deployV14: fixture } = await import("../v14-fixtures");
    return await fixture();
}
