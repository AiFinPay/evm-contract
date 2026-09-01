// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { ITokenList } from "./ITokenList.sol";
import { IProfiles } from "./IProfiles.sol";

/// @title ISplitterV14
/// @notice Interface for B2BSplitter v1.4 — EIP-712 signed, multi-route,
///         RBAC-gross payment settlement. Token whitelist and route profiles
///         are delegated to separate `ITokenList` and `IProfiles` contracts.
interface ISplitterV14 {
    // ── Data structures ──────────────────────────────────────────────────────
    struct Quote {
        address payer;
        address merchant;
        address token;
        uint256 grossAmount;
        address ipCreator;
        uint256 validUntil;
        bytes32 orderIdHash;
        uint256 nonce;
        bytes32 routeId;
    }

    struct RouteProfile {
        uint16 treasuryBps;
        uint16 ipCreatorBps;
        bool enabled;
        uint64 configuredAt;
        address routeTreasury;
    }

    struct ConstructorParams {
        address initialAdmin;
        address initialSigner;
        address initialPauser;
        address treasury;
        address tokenList;
        address profiles;
    }

    // ── Events ─────────────────────────────────────────────────────────────────
    event Payment(
        bytes32 indexed paymentId,
        address indexed payer,
        address indexed merchant,
        address token,
        uint256 grossAmount,
        uint256 merchantAmount,
        uint256 treasuryAmount,
        uint256 ipCreatorAmount,
        uint256 validUntil,
        bytes32 routeId,
        bytes32 orderIdHash
    );
    event TreasuryUpdated(address indexed newTreasury);
    // Whitelist/route events are emitted by TokenList and Profiles satellite contracts.

    // ── Roles ──────────────────────────────────────────────────────────────────
    function ADMIN_ROLE() external view returns (bytes32);
    function SIGN_OPERATOR_ROLE() external view returns (bytes32);
    function PAUSER_ROLE() external view returns (bytes32);

    // ── Constants ──────────────────────────────────────────────────────────────
    function BPS_DENOMINATOR() external pure returns (uint256);
    function EIP712_VERSION() external pure returns (string memory);
    function EIP712_NAME() external pure returns (string memory);

    // ── Satellite contracts ────────────────────────────────────────────────────
    function tokenList() external view returns (ITokenList);
    function profiles() external view returns (IProfiles);

    // ── Mutable state ──────────────────────────────────────────────────────────
    function treasury() external view returns (address);
    function payerNonce(address _payer) external view returns (uint256);
    function consumedNonce(address _payer, uint256 _nonce) external view returns (bool);

    // ── EIP-712 views ────────────────────────────────────────────────────────────
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function quoteHash(Quote calldata _quote) external pure returns (bytes32);
    function digest(Quote calldata _quote) external view returns (bytes32);

    // ── Settlement ───────────────────────────────────────────────────────────────
    function settleNative(Quote calldata _quote, bytes calldata _signature) external payable;
    function settleStable(Quote calldata _quote, bytes calldata _signature) external;

    // ── Governance ─────────────────────────────────────────────────────────────────
    function pause() external;
    function unpause() external;
    function setTreasury(address _treasury) external;
    function setWhitelistedTokens(address[] calldata _tokens, bool[] calldata _allowedFlags) external;
    function configureRoute(
        bytes32 _routeId,
        uint16 _treasuryBps,
        uint16 _ipCreatorBps,
        address _routeTreasury
    ) external;
    function disableRoute(bytes32 _routeId) external;
    function enableRoute(bytes32 _routeId) external;
    function grantSignerRole(address _account) external;
    function revokeSignerRole(address _account) external;
    function grantPauserRole(address _account) external;
    function revokePauserRole(address _account) external;
}
