// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

// ── B2BSplitter v1.3 Errors ────────────────────────────────────────────────────
error ZeroAmount();
error ZeroMerchant();
error ZeroPaymentId();
error PaymentAlreadyProcessed();
error ZeroTreasury();
error UnsupportedToken();
error PaymentTooSmallForRoyalty();
error PaymentTooSmallForTreasury();
error TreasuryFeeTooHigh();
error IPCreatorFeeTooHigh();
error MerchantTransferFailed();
error TreasuryTransferFailed();
error IPCreatorTransferFailed();
error IncorrectNativeValue(uint256 expected, uint256 received);
error InvalidProductionSplit(uint256 treasuryBps, uint256 ipCreatorBps);
error PaymentExpired(uint256 validUntil, uint256 currentTime);
error MissingIPCreator();

// ── B2BSplitter v1.4 Errors ────────────────────────────────────────────────────
error InvalidSigner();
error InvalidSignature();
error InvalidSignatureLength();
error SignatureExpired(uint256 validUntil, uint256 currentTime);
error InvalidPayer();
error InvalidNonce();
error NonceAlreadyConsumed();
error NonceOverflow();
error InvalidTokenForNative();
error UnknownRoute(bytes32 routeId);
error RouteDisabled(bytes32 routeId);
error RouteAlreadyExists(bytes32 routeId);
error RouteNotFound(bytes32 routeId);
error ZeroSigner();
error ZeroPauser();
error PauserEqualsSigner();
error AdminEqualsSigner();
error ZeroAdmin();

// ── Shared / Whitelist / Timelock Errors ───────────────────────────────────────
error ZeroAddress();
error ArrayLengthMismatch();
error ZeroProposer();
error DelayTooShort();
error NotProposer();
