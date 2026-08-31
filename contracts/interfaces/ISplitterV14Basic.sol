// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { ITokenList } from "./ITokenList.sol";
import { IProfiles } from "./IProfiles.sol";

/// @title ISplitterV14Basic
/// @notice Minimal splitter-only surface for B2BSplitter v1.4. Contains the
///         settlement entry points, the EIP-712 digest helpers, and read-only
///         economics quoting. No governance, RBAC management, or route
///         configuration is exposed here.
interface ISplitterV14Basic {
    // ── Data structures ────────────────────────────────────────────────────────
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

    // ── Settlement ─────────────────────────────────────────────────────────────
    function settleNative(Quote calldata _quote, bytes calldata _signature) external payable;
    function settleStable(Quote calldata _quote, bytes calldata _signature) external;

    // ── EIP-712 helpers ────────────────────────────────────────────────────────
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function quoteHash(Quote calldata _quote) external pure returns (bytes32);
    function digest(Quote calldata _quote) external view returns (bytes32);

    // ── Quoting / route readout ────────────────────────────────────────────────
    function quoteTotal(uint256 _grossAmount, bytes32 _routeId, address _ipCreator)
        external
        view
        returns (uint256 merchantAmount, uint256 treasuryAmount, uint256 ipCreatorAmount, uint256 totalAmount);

    function treasury() external view returns (address);
    function tokenList() external view returns (ITokenList);
    function profiles() external view returns (IProfiles);
}
