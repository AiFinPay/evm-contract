// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

// ── AiFinPayCore Errors ────────────────────────────────────────────────────────
error ZeroOwner();
error ZeroMSECCO();
error ZeroPassport();
error ZeroTreasury();
error ZeroPartner();
error EmptyPartnerName();
error InvalidAgreementHash();
/// @notice A whitelisted stablecoin reports decimals that cannot represent a
///         whole USD cent, or are implausibly large. Fail closed rather than
///         credit a wrong amount (AIFINP-120).
error UnsupportedTokenDecimals(address token, uint8 decimals);
error ZeroNative();
error InsufficientNativeForFee();
error InvalidPythPrice();
error UnexpectedPriceExponent();
error BelowMinimum();
error UnsupportedToken();
error NoSeatFound();
error PartnerNotActive();
error AgentNotVerifiedB2B();
error PaymentBelowMinimum();
error SpendAmountTooLarge();
error DailySpendLimitExceeded();
error ProtocolFeeFailed();
error MerchantTransferFailed();
error TreasuryTransferFailed();
error IPCreatorTransferFailed();
error BonusAlreadyClaimed();
error NoReferrals();
error FeesExceed100();
error TreasuryFeeTooLow();
error TreasuryFeeTooHigh();
error IPCreatorFeeTooHigh();
error ARPFeeTooHigh();
error ProtocolPaused();

// ── MSECCOToken Errors ─────────────────────────────────────────────────────────
error CoreAlreadySet();
error ZeroAddress();
error OnlyCore();
error NonTransferable();

// ── AgentPassport Errors ───────────────────────────────────────────────────────
error PassportAlreadyExists();
error NoPassport();
error Soulbound();

// ── B2BSplitter Errors ─────────────────────────────────────────────────────────
error ZeroAmount();
error ZeroMerchant();
error PaymentTooSmall();
error PaymentTooSmallForTreasury();
error PaymentTooSmallForRoyalty();
error PaymentTooSmallForMerchant();
error ZeroPaymentId(); // AIFINP-35 — paymentId must be non-zero
error PaymentAlreadyProcessed(); // AIFINP-35 — replay: paymentId already settled

// ── TimelockWrapper Errors ─────────────────────────────────────────────────────
error ZeroProposer();
error DelayTooShort();
error NotProposer();

// ── AiFinPayCore Whitelist Errors ──────────────────────────────────────────────
error ArrayLengthMismatch();
