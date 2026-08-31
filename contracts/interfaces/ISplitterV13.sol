// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title ISplitterV13
/// @notice Interface for B2BSplitter v1.3 — gross-inclusive, single-route
///         stable/native payment settlement.
interface ISplitterV13 {
    // ── Events ─────────────────────────────────────────────────────────────────
    event Payment(
        bytes32 indexed paymentId,
        address indexed payer,
        address indexed merchant,
        address token,
        uint256 totalAmount,
        uint256 merchantAmount,
        uint256 treasuryAmount,
        uint256 ipCreatorAmount,
        uint256 validUntil,
        string orderId
    );
    event SplitConfigured(uint256 indexed treasuryBps, uint256 indexed ipCreatorBps);
    event TreasuryUpdated(address indexed newTreasury);
    event WhitelistedTokensUpdated(address[] tokens, bool[] allowed);

    // ── Structs ────────────────────────────────────────────────────────────────
    struct NativePayment {
        bytes32 paymentId;
        address payable merchant;
        uint256 grossAmount;
        address ipCreator;
        uint256 validUntil;
        string orderId;
    }

    struct StablePayment {
        bytes32 paymentId;
        address token;
        uint256 grossAmount;
        address merchant;
        address ipCreator;
        uint256 validUntil;
        string orderId;
    }

    struct ConstructorParams {
        address initialOwner;
        address treasury;
        address[] stablecoins;
        uint256 treasuryBps;
        uint256 ipCreatorBps;
    }

    // ── Constants ──────────────────────────────────────────────────────────────
    function BPS_DENOMINATOR() external pure returns (uint256);
    function AIFP1_TREASURY_BPS() external pure returns (uint256);
    function MAX_TREASURY_BPS() external pure returns (uint256);
    function MAX_IP_CREATOR_BPS() external pure returns (uint256);

    // ── Immutable economics ──────────────────────────────────────────────────
    function treasuryBps() external view returns (uint256);
    function ipCreatorBps() external view returns (uint256);

    // ── Mutable state ──────────────────────────────────────────────────────────
    function treasury() external view returns (address);
    function whitelistedTokens(address _token) external view returns (bool);
    function consumedPayment(bytes32 _paymentId) external view returns (bool);

    // ── Settlement ───────────────────────────────────────────────────────────
    function payNative(NativePayment calldata _payment) external payable;
    function payStable(StablePayment calldata _payment) external;

    // ── Views ──────────────────────────────────────────────────────────────────
    function quoteTotal(
        uint256 _grossAmount,
        address _ipCreator
    )
        external
        view
        returns (uint256 merchantAmount, uint256 treasuryAmount, uint256 ipCreatorAmount, uint256 totalAmount);

    // ── Governance ───────────────────────────────────────────────────────────
    function pause() external;
    function unpause() external;
    function setTreasury(address _treasury) external;
    function setWhitelistedTokens(address[] calldata _tokens, bool[] calldata _allowed) external;
}
