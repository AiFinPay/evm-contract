// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title ISplitterV13Basic
/// @notice Minimal splitter-only surface for B2BSplitter v1.3. Contains the
///         caller-supplied payment entry points and quote view. No governance
///         or whitelist management is exposed here.
interface ISplitterV13Basic {
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

    // ── Settlement ─────────────────────────────────────────────────────────────
    function payNative(NativePayment calldata _payment) external payable;
    function payStable(StablePayment calldata _payment) external;

    // ── Quoting ────────────────────────────────────────────────────────────────
    function quoteTotal(
        uint256 _grossAmount,
        address _ipCreator
    )
        external
        view
        returns (uint256 merchantAmount, uint256 treasuryAmount, uint256 ipCreatorAmount, uint256 totalAmount);

    // ── Read-only state ────────────────────────────────────────────────────────
    function treasury() external view returns (address);
    function whitelistedTokens(address _token) external view returns (bool);
    function consumedPayment(bytes32 _paymentId) external view returns (bool);
}
