import { expect } from "chai";

import { ethers, loadFixture } from "../fixtures";

// Mirrors the AIFP-3 acceptance criteria in the vNext handoff (§14).
describe("AgentPassportV3 (AIFP-3 global identity)", function () {
  const AGENT_ID_STRING = "aifp_agent_0123456789abcdef0123456789abcdef";
  const ISSUER_KEY_ID = ethers.id("aifp3-ed25519-7f1c2a9b4e6d8035");
  const LEVEL_SELF = 0;

  const Status = { NONE: 0, ACTIVE: 1, SUSPENDED: 2, REVOKED: 3 };
  const Binding = { NONE: 0, ACTIVE: 1, REVOKED: 2, BLOCKED: 3 };

  async function deploy() {
    const [owner, attestor, guardian, walletA, walletB, outsider] = await ethers.getSigners();
    const passport = await (await ethers.getContractFactory("AgentPassportV3"))
      .deploy(await owner.getAddress(), await attestor.getAddress());
    await passport.connect(owner).setGuardian(await guardian.getAddress());

    const agentId = ethers.keccak256(ethers.toUtf8Bytes(AGENT_ID_STRING));
    const domain = {
      name: "AiFinPay Agent Passport",
      version: "3",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await passport.getAddress(),
    };
    return { passport, owner, attestor, guardian, walletA, walletB, outsider, agentId, domain };
  }

  const SYNC_TYPES = {
    PassportSync: [
      { name: "agentId", type: "bytes32" },
      { name: "agentNumber", type: "uint64" },
      { name: "status", type: "uint8" },
      { name: "verificationLevel", type: "uint8" },
      { name: "version", type: "uint64" },
      { name: "issuerKeyId", type: "bytes32" },
      { name: "deadline", type: "uint256" },
    ],
  };
  const BINDING_TYPES = {
    WalletBinding: [
      { name: "agentId", type: "bytes32" },
      { name: "wallet", type: "address" },
      { name: "status", type: "uint8" },
      { name: "version", type: "uint64" },
      { name: "deadline", type: "uint256" },
    ],
  };

  const future = () => Math.floor(Date.now() / 1000) + 3600;

  async function register(ctx: any, version = 1n) {
    const msg = {
      agentId: ctx.agentId, agentNumber: 123n, status: Status.ACTIVE,
      verificationLevel: LEVEL_SELF, version, issuerKeyId: ISSUER_KEY_ID, deadline: future(),
    };
    const sig = await ctx.attestor.signTypedData(ctx.domain, SYNC_TYPES, msg);
    await ctx.passport.registerPassport(
      AGENT_ID_STRING, msg.agentNumber, msg.verificationLevel, msg.version,
      msg.issuerKeyId, msg.deadline, sig,
    );
  }

  async function bind(ctx: any, wallet: any, status: number, version: bigint, signer = ctx.attestor) {
    const msg = {
      agentId: ctx.agentId, wallet: await wallet.getAddress(),
      status, version, deadline: future(),
    };
    const sig = await signer.signTypedData(ctx.domain, BINDING_TYPES, msg);
    return ctx.passport.setWalletBinding(ctx.agentId, msg.wallet, status, version, msg.deadline, sig);
  }

  it("one agent holds many wallets under a single identity (§14.1, §14.2)", async function () {
    const ctx = await loadFixture(deploy);
    await register(ctx);
    await bind(ctx, ctx.walletA, Binding.ACTIVE, 2n);
    await bind(ctx, ctx.walletB, Binding.ACTIVE, 3n);

    expect(await ctx.passport.agentIdOf(await ctx.walletA.getAddress())).to.equal(ctx.agentId);
    expect(await ctx.passport.agentIdOf(await ctx.walletB.getAddress())).to.equal(ctx.agentId);
    expect(await ctx.passport.isAuthorizedWallet(await ctx.walletA.getAddress())).to.equal(true);
    expect(await ctx.passport.isAuthorizedWallet(await ctx.walletB.getAddress())).to.equal(true);

    // Rotating the wallet leaves the identity untouched — the whole point.
    await bind(ctx, ctx.walletA, Binding.REVOKED, 4n);
    expect((await ctx.passport.passports(ctx.agentId)).agentNumber).to.equal(123n);
    expect(await ctx.passport.agentIdOf(await ctx.walletB.getAddress())).to.equal(ctx.agentId);
  });

  it("a wallet cannot bind without an attestor signature (§14.3)", async function () {
    const ctx = await loadFixture(deploy);
    await register(ctx);
    await expect(bind(ctx, ctx.walletA, Binding.ACTIVE, 2n, ctx.outsider))
      .to.be.revertedWithCustomError(ctx.passport, "AttestationNotSigned");
    expect(await ctx.passport.isAuthorizedWallet(await ctx.walletA.getAddress())).to.equal(false);
  });

  it("a suspended passport authorizes nothing, even with a live binding (§14.4)", async function () {
    const ctx = await loadFixture(deploy);
    await register(ctx);
    await bind(ctx, ctx.walletA, Binding.ACTIVE, 2n);

    const msg = {
      agentId: ctx.agentId, agentNumber: 123n, status: Status.SUSPENDED,
      verificationLevel: LEVEL_SELF, version: 3n, issuerKeyId: ISSUER_KEY_ID, deadline: future(),
    };
    const sig = await ctx.attestor.signTypedData(ctx.domain, SYNC_TYPES, msg);
    await ctx.passport.syncPassport(ctx.agentId, 123n, Status.SUSPENDED, LEVEL_SELF, 3n, ISSUER_KEY_ID, msg.deadline, sig);

    expect(await ctx.passport.isAuthorizedWallet(await ctx.walletA.getAddress())).to.equal(false);
  });

  it("a revoked binding authorizes nothing while the passport stays active (§14.5)", async function () {
    const ctx = await loadFixture(deploy);
    await register(ctx);
    await bind(ctx, ctx.walletA, Binding.ACTIVE, 2n);
    await bind(ctx, ctx.walletB, Binding.ACTIVE, 3n);
    await bind(ctx, ctx.walletA, Binding.REVOKED, 4n);

    expect(await ctx.passport.isAuthorizedWallet(await ctx.walletA.getAddress())).to.equal(false);
    expect(await ctx.passport.isAuthorizedWallet(await ctx.walletB.getAddress())).to.equal(true);
    expect(await ctx.passport.passportStatus(ctx.agentId)).to.equal(Status.ACTIVE);
  });

  it("attestor rotation is supported and auditable (§14.6)", async function () {
    const ctx = await loadFixture(deploy);
    await register(ctx);
    const old = await ctx.attestor.getAddress();
    const next = await ctx.outsider.getAddress();

    await expect(ctx.passport.connect(ctx.owner).setAttestor(next))
      .to.emit(ctx.passport, "AttestorUpdated").withArgs(old, next);

    // The retired key stops being believed immediately.
    await expect(bind(ctx, ctx.walletA, Binding.ACTIVE, 2n, ctx.attestor))
      .to.be.revertedWithCustomError(ctx.passport, "AttestationNotSigned");
    await bind(ctx, ctx.walletA, Binding.ACTIVE, 2n, ctx.outsider);
    expect(await ctx.passport.isAuthorizedWallet(await ctx.walletA.getAddress())).to.equal(true);
  });

  it("a replayed attestation cannot re-open a suspended passport (§14.8)", async function () {
    const ctx = await loadFixture(deploy);
    await register(ctx);

    // Capture a valid ACTIVE attestation, then suspend at a higher version.
    const revive = {
      agentId: ctx.agentId, agentNumber: 123n, status: Status.ACTIVE,
      verificationLevel: LEVEL_SELF, version: 2n, issuerKeyId: ISSUER_KEY_ID, deadline: future(),
    };
    const reviveSig = await ctx.attestor.signTypedData(ctx.domain, SYNC_TYPES, revive);

    const suspend = { ...revive, status: Status.SUSPENDED, version: 3n };
    const suspendSig = await ctx.attestor.signTypedData(ctx.domain, SYNC_TYPES, suspend);
    await ctx.passport.syncPassport(ctx.agentId, 123n, Status.SUSPENDED, LEVEL_SELF, 3n, ISSUER_KEY_ID, suspend.deadline, suspendSig);

    await expect(
      ctx.passport.syncPassport(ctx.agentId, 123n, Status.ACTIVE, LEVEL_SELF, 2n, ISSUER_KEY_ID, revive.deadline, reviveSig),
    ).to.be.revertedWithCustomError(ctx.passport, "StaleVersion");
    expect(await ctx.passport.passportStatus(ctx.agentId)).to.equal(Status.SUSPENDED);
  });

  it("an attestation for another contract does not verify here (§14.8 domain separation)", async function () {
    const ctx = await loadFixture(deploy);
    await register(ctx);

    const foreignDomain = { ...ctx.domain, verifyingContract: await ctx.outsider.getAddress() };
    const msg = { agentId: ctx.agentId, wallet: await ctx.walletA.getAddress(), status: Binding.ACTIVE, version: 2n, deadline: future() };
    const sig = await ctx.attestor.signTypedData(foreignDomain, BINDING_TYPES, msg);

    await expect(
      ctx.passport.setWalletBinding(ctx.agentId, msg.wallet, msg.status, msg.version, msg.deadline, sig),
    ).to.be.revertedWithCustomError(ctx.passport, "AttestationNotSigned");
  });

  it("an expired attestation is refused", async function () {
    const ctx = await loadFixture(deploy);
    await register(ctx);
    const past = Math.floor(Date.now() / 1000) - 60;
    const msg = { agentId: ctx.agentId, wallet: await ctx.walletA.getAddress(), status: Binding.ACTIVE, version: 2n, deadline: past };
    const sig = await ctx.attestor.signTypedData(ctx.domain, BINDING_TYPES, msg);
    await expect(
      ctx.passport.setWalletBinding(ctx.agentId, msg.wallet, msg.status, msg.version, past, sig),
    ).to.be.revertedWithCustomError(ctx.passport, "AttestationExpired");
  });

  it("a wallet cannot be claimed by a second agent", async function () {
    const ctx = await loadFixture(deploy);
    await register(ctx);
    await bind(ctx, ctx.walletA, Binding.ACTIVE, 2n);

    const otherId = ethers.keccak256(ethers.toUtf8Bytes("aifp_agent_ffffffffffffffffffffffffffffffff"));
    const msg = { agentId: otherId, wallet: await ctx.walletA.getAddress(), status: Binding.ACTIVE, version: 9n, deadline: future() };
    const sig = await ctx.attestor.signTypedData(ctx.domain, BINDING_TYPES, msg);
    await expect(
      ctx.passport.setWalletBinding(otherId, msg.wallet, msg.status, msg.version, msg.deadline, sig),
    ).to.be.revertedWithCustomError(ctx.passport, "UnknownPassport");
  });

  it("a revoked passport is final — it cannot be restored", async function () {
    const ctx = await loadFixture(deploy);
    await register(ctx);
    const revoke = {
      agentId: ctx.agentId, agentNumber: 123n, status: Status.REVOKED,
      verificationLevel: LEVEL_SELF, version: 2n, issuerKeyId: ISSUER_KEY_ID, deadline: future(),
    };
    const revokeSig = await ctx.attestor.signTypedData(ctx.domain, SYNC_TYPES, revoke);
    await ctx.passport.syncPassport(ctx.agentId, 123n, Status.REVOKED, LEVEL_SELF, 2n, ISSUER_KEY_ID, revoke.deadline, revokeSig);

    const restore = { ...revoke, status: Status.ACTIVE, version: 3n };
    const restoreSig = await ctx.attestor.signTypedData(ctx.domain, SYNC_TYPES, restore);
    await expect(
      ctx.passport.syncPassport(ctx.agentId, 123n, Status.ACTIVE, LEVEL_SELF, 3n, ISSUER_KEY_ID, restore.deadline, restoreSig),
    ).to.be.revertedWithCustomError(ctx.passport, "InvalidStatus");
  });

  it("the guardian can stop instantly but never restore", async function () {
    const ctx = await loadFixture(deploy);
    await register(ctx);
    await bind(ctx, ctx.walletA, Binding.ACTIVE, 2n);

    await ctx.passport.connect(ctx.guardian).guardianBlockWallet(await ctx.walletA.getAddress());
    expect(await ctx.passport.isAuthorizedWallet(await ctx.walletA.getAddress())).to.equal(false);

    await ctx.passport.connect(ctx.guardian).guardianSuspendPassport(ctx.agentId);
    expect(await ctx.passport.passportStatus(ctx.agentId)).to.equal(Status.SUSPENDED);

    // No restore path exists on the guardian surface at all.
    expect((ctx.passport as any).guardianRestorePassport).to.equal(undefined);
    await expect(
      ctx.passport.connect(ctx.outsider).guardianSuspendPassport(ctx.agentId),
    ).to.be.revertedWithCustomError(ctx.passport, "NotGuardian");
  });

  it("agentIdHash matches keccak256 of the canonical agent_id string", async function () {
    const ctx = await loadFixture(deploy);
    expect(await ctx.passport.agentIdHash(AGENT_ID_STRING))
      .to.equal(ethers.keccak256(ethers.toUtf8Bytes(AGENT_ID_STRING)));
  });
});
