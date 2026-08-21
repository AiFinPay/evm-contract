// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @title AgentPassportV3 — on-chain mirror of the global AIFP-3 Agent Passport
/// @notice One agent is one immutable `agent_id`. Chain wallets are *bindings*
///         under that identity, never identities of their own. Supersedes
///         `AgentPassport.sol`, which keyed identity by wallet
///         (`agentTokenId[address]`) and so gave one agent a separate identity
///         on every chain it touched.
///
/// @dev **Where this contract sits.** The passport is issued by AiFinPay
///      off-chain and stays globally valid independent of any blockchain.
///      Nothing here issues an identity; this is the mirror and enforcement
///      layer for one chain. The separation of concerns, in AiFinPay's terms:
///
///      - AIFP-3 Passport      — the global AiFinPay identity (off-chain)
///      - Issuer Ed25519       — AiFinPay authenticity
///      - Holder Ed25519       — agent control
///      - Wallet proof         — authorization of one specific wallet
///      - Operational attestor — automated bridge to on-chain state
///      - Governance Safe      — governance / security layer
///      - This contract        — mirror + enforcement
///
/// @dev **Mirroring is lazy.** A passport exists the moment AiFinPay issues
///      it; it is not written to nine chains on creation. A chain's mirror is
///      created the first time an agent actually transacts there, so onboarding
///      costs no transactions at all and each chain carries only the agents
///      that use it.
///
/// @dev **Why this is not an ERC-721.** The previous passport was a soulbound
///      NFT, and an NFT has exactly one owner address. An identity that must
///      span many wallets on many chains cannot be modelled that way without
///      nominating one wallet as "the" owner — which is the wallet-centric
///      semantics AIFP-3 exists to remove. This is a registry instead.
///
/// @dev **Why an attestor rather than the issuer signature.** Off-chain, a
///      passport is trusted because AiFinPay signs a canonical JSON payload
///      with an Ed25519 issuer key. The EVM has no Ed25519 precompile, and the
///      signed message is canonical JSON that would have to be rebuilt on-chain
///      — neither is viable. So state is mirrored here by an `attestor`
///      secp256k1 key over EIP-712 typed data, and `issuerKeyId` records which
///      off-chain Ed25519 key vouched for the state, so the two sides remain
///      auditable against each other. The attestor proves *who is speaking*;
///      it is never a source of truth about the agent.
contract AgentPassportV3 is Ownable, Pausable, EIP712 {
    enum Status {
        NONE,
        ACTIVE,
        SUSPENDED,
        REVOKED
    }

    enum BindingStatus {
        NONE,
        ACTIVE,
        REVOKED,
        BLOCKED
    }

    struct Passport {
        uint64 agentNumber;
        uint64 version;
        uint64 updatedAt;
        Status status;
        uint8 verificationLevel;
        bytes32 issuerKeyId;
    }

    /// @notice Global identity, keyed by keccak256 of the canonical `agent_id`
    ///         string (`aifp_agent_<32 hex>`). Hashing rather than storing the
    ///         string keeps the key fixed-width and survives a change to the
    ///         id format; the string itself is emitted on registration so the
    ///         mapping back to off-chain records stays reconstructible.
    mapping(bytes32 => Passport) public passports;

    /// @notice wallet => agentId it is bound to. A wallet belongs to at most
    ///         one agent, which is what makes reverse lookup at payment time
    ///         a single storage read.
    mapping(address => bytes32) public walletAgent;

    /// @notice agentId => wallet => binding state.
    mapping(bytes32 => mapping(address => BindingStatus)) public bindings;

    /// @notice Mirrors backend state onto this chain. Not an authority.
    /// @dev The operational attestor is an **automated production signer**. The
    ///      backend first validates the canonical AIFP-3 state — issuer
    ///      signature, holder authorization, wallet proof, current version and
    ///      status — and only then issues the EIP-712 attestation, from a key
    ///      that should live in KMS/HSM or equivalent.
    ///
    ///      It is deliberately **not** the governance Safe. Putting a multisig
    ///      in the routine path would make every new passport, every status
    ///      change and every wallet binding wait on human signatures, which
    ///      does not scale to millions of agents. Governance sits *above* this
    ///      key and rotates it; it does not sign for it.
    ///
    ///      Verification goes through SignatureChecker, so the attestor may be
    ///      an EOA **or** an ERC-1271 contract wallet — an operator who wants a
    ///      threshold on the operational key itself can have one. The invariant
    ///      is the separation of operational signing from governance, not the
    ///      shape of either key.
    address public attestor;

    /// @notice May instantly suspend an agent or block a wallet, and nothing
    ///         else. Cannot move value, cannot restore. Exists because the
    ///         governance owner is expected to sit behind a 48h timelock, and
    ///         an emergency stop that takes two days is not an emergency stop.
    address public guardian;

    bytes32 private constant PASSPORT_SYNC_TYPEHASH = keccak256(
        "PassportSync(bytes32 agentId,uint64 agentNumber,uint8 status,uint8 verificationLevel,"
        "uint64 version,bytes32 issuerKeyId,uint256 deadline)"
    );

    bytes32 private constant WALLET_BINDING_TYPEHASH = keccak256(
        "WalletBinding(bytes32 agentId,address wallet,uint8 status,uint64 version,uint256 deadline)"
    );

    event PassportMirrored(bytes32 indexed agentId, string agentIdString, uint64 agentNumber);
    event PassportSynced(
        bytes32 indexed agentId,
        Status status,
        uint8 verificationLevel,
        uint64 version,
        bytes32 issuerKeyId
    );
    event WalletBound(bytes32 indexed agentId, address indexed wallet, uint64 version);
    event WalletBindingChanged(bytes32 indexed agentId, address indexed wallet, BindingStatus status, uint64 version);
    event AttestorUpdated(address indexed previousAttestor, address indexed newAttestor);
    event GuardianUpdated(address indexed previousGuardian, address indexed newGuardian);
    event GuardianSuspendedPassport(bytes32 indexed agentId, address indexed guardian);
    event GuardianBlockedWallet(bytes32 indexed agentId, address indexed wallet, address indexed guardian);

    error ZeroAttestor();
    error ZeroAgentId();
    error NotGuardian();
    error AttestationExpired(uint256 deadline, uint256 nowTimestamp);
    error AttestationNotSigned();
    error StaleVersion(uint64 provided, uint64 stored);
    error UnknownPassport(bytes32 agentId);
    error PassportAlreadyMirrored(bytes32 agentId);
    error InvalidStatus();
    error WalletBoundToAnotherAgent(address wallet, bytes32 boundTo);
    error AgentIdMismatch();

    constructor(
        address initialOwner,
        address initialAttestor
    ) Ownable(initialOwner) EIP712("AiFinPay Agent Passport", "3") {
        if (initialAttestor == address(0)) revert ZeroAttestor();
        attestor = initialAttestor;
        emit AttestorUpdated(address(0), initialAttestor);
    }

    // ---------------------------------------------------------------- reads

    /// @notice The question every payment path actually asks: may this wallet
    ///         act for its agent right now? Both the binding and the passport
    ///         must be live, so revoking either one closes the route.
    function isAuthorizedWallet(address _wallet) public view returns (bool) {
        bytes32 agentId = walletAgent[_wallet];
        if (agentId == bytes32(0)) return false;
        if (bindings[agentId][_wallet] != BindingStatus.ACTIVE) return false;
        return passports[agentId].status == Status.ACTIVE;
    }

    /// @notice Resolve a wallet to its global agent identity regardless of the
    ///         chain it was bound on. Returns 0 when the wallet is unknown.
    function agentIdOf(address _wallet) external view returns (bytes32) {
        return walletAgent[_wallet];
    }

    function passportStatus(bytes32 _agentId) external view returns (Status) {
        return passports[_agentId].status;
    }

    /// @notice Canonical on-chain key for an `agent_id` string. Exposed so the
    ///         backend and any integrator derive the identical value rather
    ///         than reimplementing the rule.
    function agentIdHash(string calldata _agentId) external pure returns (bytes32) {
        return keccak256(bytes(_agentId));
    }

    // -------------------------------------------------------- attested writes

    /// @notice Create this chain's mirror of a passport AiFinPay has already
    ///         issued. Named `mirrorPassport` rather than `register` because
    ///         the identity exists before this call and does not depend on it:
    ///         the chain records the state, it never confers it.
    /// @dev Anyone may submit; only a valid attestor signature makes it count.
    ///      That is what makes lazy mirroring work — AiFinPay holds gas on no
    ///      chain, and whoever first needs the agent on this chain can create
    ///      the mirror.
    function mirrorPassport(
        string calldata _agentIdString,
        uint64 _agentNumber,
        uint8 _verificationLevel,
        uint64 _version,
        bytes32 _issuerKeyId,
        uint256 _deadline,
        bytes calldata _signature
    ) external whenNotPaused {
        bytes32 agentId = keccak256(bytes(_agentIdString));
        if (agentId == bytes32(0)) revert ZeroAgentId();
        if (passports[agentId].status != Status.NONE) revert PassportAlreadyMirrored(agentId);

        _verifyPassportSync(
            agentId,
            _agentNumber,
            uint8(Status.ACTIVE),
            _verificationLevel,
            _version,
            _issuerKeyId,
            _deadline,
            _signature
        );

        passports[agentId] = Passport({
            agentNumber: _agentNumber,
            version: _version,
            updatedAt: uint64(block.timestamp),
            status: Status.ACTIVE,
            verificationLevel: _verificationLevel,
            issuerKeyId: _issuerKeyId
        });

        emit PassportMirrored(agentId, _agentIdString, _agentNumber);
        emit PassportSynced(agentId, Status.ACTIVE, _verificationLevel, _version, _issuerKeyId);
    }

    /// @notice Mirror a lifecycle change — suspend, restore, revoke, or a new
    ///         verification level.
    /// @dev The backend bumps `version` on every passport change, so requiring
    ///      a strictly greater version is both the replay guard and the
    ///      ordering guarantee: a stale attestation can never re-open a
    ///      passport that was later suspended.
    function syncPassport(
        bytes32 _agentId,
        uint64 _agentNumber,
        uint8 _status,
        uint8 _verificationLevel,
        uint64 _version,
        bytes32 _issuerKeyId,
        uint256 _deadline,
        bytes calldata _signature
    ) external whenNotPaused {
        Passport storage p = passports[_agentId];
        if (p.status == Status.NONE) revert UnknownPassport(_agentId);
        if (_status == uint8(Status.NONE) || _status > uint8(Status.REVOKED)) revert InvalidStatus();
        // A revoked passport is final off-chain; it must be final here too, or
        // this contract becomes a way to launder a revocation into an active
        // identity again.
        if (p.status == Status.REVOKED) revert InvalidStatus();
        if (_version <= p.version) revert StaleVersion(_version, p.version);

        _verifyPassportSync(
            _agentId,
            _agentNumber,
            _status,
            _verificationLevel,
            _version,
            _issuerKeyId,
            _deadline,
            _signature
        );

        p.agentNumber = _agentNumber;
        p.status = Status(_status);
        p.verificationLevel = _verificationLevel;
        p.version = _version;
        p.issuerKeyId = _issuerKeyId;
        p.updatedAt = uint64(block.timestamp);

        emit PassportSynced(_agentId, Status(_status), _verificationLevel, _version, _issuerKeyId);
    }

    /// @notice Bind, revoke or block one wallet under a global identity.
    /// @dev Off-chain, a wallet binding is proved by two signatures — the
    ///      holder key and the wallet key. Both are Ed25519-or-chain-specific
    ///      and verified by the backend; re-proving them here is neither
    ///      possible nor useful, so this mirrors the *result* of that check.
    function setWalletBinding(
        bytes32 _agentId,
        address _wallet,
        uint8 _status,
        uint64 _version,
        uint256 _deadline,
        bytes calldata _signature
    ) external whenNotPaused {
        Passport storage p = passports[_agentId];
        if (p.status == Status.NONE) revert UnknownPassport(_agentId);
        if (_status == uint8(BindingStatus.NONE) || _status > uint8(BindingStatus.BLOCKED)) revert InvalidStatus();
        if (_version <= p.version) revert StaleVersion(_version, p.version);

        bytes32 boundTo = walletAgent[_wallet];
        if (boundTo != bytes32(0) && boundTo != _agentId) revert WalletBoundToAnotherAgent(_wallet, boundTo);

        if (_deadline < block.timestamp) revert AttestationExpired(_deadline, block.timestamp);
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(WALLET_BINDING_TYPEHASH, _agentId, _wallet, _status, _version, _deadline))
        );
        if (!SignatureChecker.isValidSignatureNow(attestor, digest, _signature)) revert AttestationNotSigned();

        BindingStatus status = BindingStatus(_status);
        bool isNew = bindings[_agentId][_wallet] == BindingStatus.NONE;
        bindings[_agentId][_wallet] = status;
        walletAgent[_wallet] = _agentId;

        // The wallet stays resolvable to its agent after revocation. Forgetting
        // the link would let a revoked wallet be re-bound elsewhere and would
        // erase the history a payment dispute needs.
        p.version = _version;
        p.updatedAt = uint64(block.timestamp);

        if (isNew) emit WalletBound(_agentId, _wallet, _version);
        emit WalletBindingChanged(_agentId, _wallet, status, _version);
    }

    // ------------------------------------------------------------- guardian

    /// @notice Instant stop. Deliberately one-way: the guardian can close a
    ///         route but never re-open one. Restoring goes back through the
    ///         attested path, which is what an incident review should produce.
    function guardianSuspendPassport(bytes32 _agentId) external {
        if (msg.sender != guardian) revert NotGuardian();
        Passport storage p = passports[_agentId];
        if (p.status == Status.NONE) revert UnknownPassport(_agentId);
        p.status = Status.SUSPENDED;
        p.updatedAt = uint64(block.timestamp);
        emit GuardianSuspendedPassport(_agentId, msg.sender);
        emit PassportSynced(_agentId, Status.SUSPENDED, p.verificationLevel, p.version, p.issuerKeyId);
    }

    function guardianBlockWallet(address _wallet) external {
        if (msg.sender != guardian) revert NotGuardian();
        bytes32 agentId = walletAgent[_wallet];
        if (agentId == bytes32(0)) revert UnknownPassport(bytes32(0));
        bindings[agentId][_wallet] = BindingStatus.BLOCKED;
        emit GuardianBlockedWallet(agentId, _wallet, msg.sender);
        emit WalletBindingChanged(agentId, _wallet, BindingStatus.BLOCKED, passports[agentId].version);
    }

    // ------------------------------------------------------------ governance
    // The owner is the governance Safe (behind a timelock wherever one is
    // wired). Its powers are exactly these three: rotate the attestor, change
    // the guardian, pause/unpause — plus ownership itself. It is never in the
    // path of mirroring a passport or binding a wallet.

    /// @notice Rotate the attesting key. Required, not optional: an attestor
    ///         with no rotation path is a permanent single point of failure.
    function setAttestor(address _attestor) external onlyOwner {
        if (_attestor == address(0)) revert ZeroAttestor();
        emit AttestorUpdated(attestor, _attestor);
        attestor = _attestor;
    }

    function setGuardian(address _guardian) external onlyOwner {
        emit GuardianUpdated(guardian, _guardian);
        guardian = _guardian;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // -------------------------------------------------------------- internal

    function _verifyPassportSync(
        bytes32 _agentId,
        uint64 _agentNumber,
        uint8 _status,
        uint8 _verificationLevel,
        uint64 _version,
        bytes32 _issuerKeyId,
        uint256 _deadline,
        bytes calldata _signature
    ) private view {
        if (_deadline < block.timestamp) revert AttestationExpired(_deadline, block.timestamp);
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    PASSPORT_SYNC_TYPEHASH,
                    _agentId,
                    _agentNumber,
                    _status,
                    _verificationLevel,
                    _version,
                    _issuerKeyId,
                    _deadline
                )
            )
        );
        if (!SignatureChecker.isValidSignatureNow(attestor, digest, _signature)) revert AttestationNotSigned();
    }
}
