// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {
    ZeroAmount,
    ZeroMerchant,
    ZeroNative,
    ZeroPaymentId,
    ZeroTreasury,
    UnsupportedToken,
    PaymentAlreadyProcessed,
    PaymentBelowMinimum,
    PaymentTooSmallForMerchant,
    PaymentTooSmallForRoyalty,
    PaymentTooSmallForTreasury,
    FeesExceed100,
    TreasuryFeeTooHigh,
    TreasuryFeeTooLow,
    IPCreatorFeeTooHigh,
    MerchantTransferFailed,
    TreasuryTransferFailed,
    IPCreatorTransferFailed
} from "./errors/Errors.sol";
import {Whitelist} from "./Whitelist.sol";

/// @title B2BSplitter v1.2 — AiFinPay Standalone Payment Splitter [DEPRECATED]
/// @notice Splits an incoming native or ERC-20 payment between merchant, treasury,
///         and IP creator, atomically, once per paymentId. Owner is the team Gnosis
///         Safe on Polygon; on the other chains it is the deployer EOA, since no Safe
///         exists there yet (migration to multisig is tracked separately).
/// @dev DEPRECATED — do not deploy for new integrations. Use B2BSplitterV13 for all
///      new routes. This file is kept in the repo only to preserve source-verification
///      and incident-response capability for the live v1.2 deployments listed below.
///      No upgradeability — redeploy to change logic. v1.2 = audit remediation:
///      - AIFINP-34: stablecoins are per-chain, fixed at deploy (no Polygon hardcodes).
///      - AIFINP-35: on-chain paymentId idempotency / replay protection.
///      - AIFINP-33: zero IP-creator value is redirected to the merchant, never
///                   skipped or stranded. Invariant: merchant + treasury + ip == total.
///      Function signatures changed (paymentId added; payMatic -> payNative); the
///      SDK/backend must be updated to match.
///
///      Status: compiled (solc 0.8.35, optimizer 200, cancun), 138 tests passing, and
///      deployed to four mainnets on 2026-07-31 — Polygon, Optimism, BOT Chain and
///      XRPL EVM — all source-verified. The exact bytecode deployed reproduces from the
///      tag `b2bsplitter-v1.2-mainnet`, not from this branch head: Solidity embeds a
///      hash of the source, so later edits (including this comment) change the metadata
///      tail without changing the executable code.
///
///      Verified live on Polygon: a 0.01 POL payment split 98.99/1.00/0.01 with nothing
///      retained by the contract, and the same paymentId resubmitted reverted on-chain
///      with PaymentAlreadyProcessed.
contract B2BSplitter is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using Whitelist for mapping(address => bool);

    /// @notice Tokens accepted for stablecoin payments. Owner can update after deployment.
    mapping(address => bool) public whitelistedTokens;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MIN_PAYMENT = 100_000;
    uint256 public constant MAX_TREASURY_BPS = 500;
    uint256 public constant MAX_IP_CREATOR_BPS = 100;

    uint256 public treasuryBps = 100;
    uint256 public ipCreatorBps = 1;
    address public treasury;

    // AIFINP-35 — a paymentId can settle at most once.
    mapping(bytes32 => bool) public consumedPayment;

    event Payment(
        bytes32 indexed paymentId,
        address indexed payer,
        address indexed merchant,
        address token,
        uint256 totalAmount,
        uint256 merchantAmount,
        uint256 treasuryAmount,
        uint256 ipCreatorAmount,
        string orderId
    );
    event SplitUpdated(uint256 treasuryBps, uint256 ipCreatorBps);
    event TreasuryUpdated(address newTreasury);
    event WhitelistedTokensUpdated(address[] tokens, bool[] allowed);

    /// @param initialOwner Gnosis Safe multisig
    /// @param _treasury    AiFinPay treasury (fee recipient)
    /// @param _usdc        This chain's USDC (or address(0) if not supported here)
    /// @param _usdt        This chain's USDT (or address(0) if not supported here)
    constructor(address initialOwner, address _treasury, address _usdc, address _usdt) Ownable(initialOwner) {
        if (_treasury == address(0)) revert ZeroTreasury();
        treasury = _treasury;

        bool[] memory allowed = new bool[](2);
        if (_usdc != address(0)) {
            whitelistedTokens.set(_usdc, true);
            allowed[0] = true;
        }
        if (_usdt != address(0)) {
            whitelistedTokens.set(_usdt, true);
            allowed[1] = true;
        }
        address[] memory initialTokens = new address[](2);
        initialTokens[0] = _usdc;
        initialTokens[1] = _usdt;
        emit WhitelistedTokensUpdated(initialTokens, allowed);
    }

    /// @notice Pay a merchant in the native token. Splits on-chain, once per paymentId.
    /// @param _paymentId Unique payment id (from the signed AIFP-2 quote). Reused id reverts.
    /// @param _merchant  Merchant wallet address
    /// @param _ipCreator IP creator address (receives royalty). Pass address(0) to skip.
    /// @param _orderId   Off-chain order reference (human-readable, not a uniqueness guard)
    function payNative(
        bytes32 _paymentId,
        address payable _merchant,
        address _ipCreator,
        string calldata _orderId
    ) external payable nonReentrant whenNotPaused {
        _consume(_paymentId);
        if (msg.value == 0) revert ZeroNative();
        if (_merchant == address(0)) revert ZeroMerchant();

        (uint256 merchantAmt, uint256 treasuryAmt, uint256 ipAmt) = _split(msg.value, _ipCreator);

        (bool s1, ) = _merchant.call{value: merchantAmt}("");
        if (!s1) revert MerchantTransferFailed();

        (bool s2, ) = payable(treasury).call{value: treasuryAmt}("");
        if (!s2) revert TreasuryTransferFailed();

        if (ipAmt > 0) {
            (bool s3, ) = payable(_ipCreator).call{value: ipAmt}("");
            if (!s3) revert IPCreatorTransferFailed();
        }

        emit Payment(
            _paymentId,
            msg.sender,
            _merchant,
            address(0),
            msg.value,
            merchantAmt,
            treasuryAmt,
            ipAmt,
            _orderId
        );
    }

    /// @notice Pay a merchant in THIS chain's USDC or USDT. Splits on-chain, once per paymentId.
    /// @dev Caller must approve this contract for `_amount` first.
    function payStable(
        bytes32 _paymentId,
        address _token,
        uint256 _amount,
        address _merchant,
        address _ipCreator,
        string calldata _orderId
    ) external nonReentrant whenNotPaused {
        _consume(_paymentId);
        // AIFINP-34 — reject address(0) explicitly so an unset (address(0)) token can't be matched.
        if (_token == address(0) || !whitelistedTokens.isAllowed(_token)) revert UnsupportedToken();
        if (_amount == 0) revert ZeroAmount();
        if (_merchant == address(0)) revert ZeroMerchant();

        (uint256 merchantAmt, uint256 treasuryAmt, uint256 ipAmt) = _split(_amount, _ipCreator);

        IERC20(_token).safeTransferFrom(msg.sender, _merchant, merchantAmt);
        IERC20(_token).safeTransferFrom(msg.sender, treasury, treasuryAmt);
        if (ipAmt > 0) {
            IERC20(_token).safeTransferFrom(msg.sender, _ipCreator, ipAmt);
        }

        emit Payment(_paymentId, msg.sender, _merchant, _token, _amount, merchantAmt, treasuryAmt, ipAmt, _orderId);
    }

    /// @dev AIFINP-35 — set consumed BEFORE any external transfer (checks-effects-interactions).
    function _consume(bytes32 _paymentId) internal {
        if (_paymentId == bytes32(0)) revert ZeroPaymentId();
        if (consumedPayment[_paymentId]) revert PaymentAlreadyProcessed();
        consumedPayment[_paymentId] = true;
    }

    /// @notice Emergency pause — halts all payments instantly
    /// @dev Requires timelock delay if owner is TimelockController
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume payments after an emergency pause
    /// @dev Requires timelock delay if owner is TimelockController
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Update fee split percentages
    /// @dev Requires timelock delay if owner is TimelockController
    function setSplit(uint256 _treasuryBps, uint256 _ipCreatorBps) external onlyOwner {
        if (_treasuryBps + _ipCreatorBps >= BPS_DENOMINATOR) revert FeesExceed100();
        if (_treasuryBps < 1) revert TreasuryFeeTooLow();
        if (_treasuryBps > MAX_TREASURY_BPS) revert TreasuryFeeTooHigh();
        if (_ipCreatorBps > MAX_IP_CREATOR_BPS) revert IPCreatorFeeTooHigh();
        treasuryBps = _treasuryBps;
        ipCreatorBps = _ipCreatorBps;
        emit SplitUpdated(_treasuryBps, _ipCreatorBps);
    }

    /// @notice Update treasury address
    /// @dev Requires timelock delay if owner is TimelockController
    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroTreasury();
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    /// @notice Add or remove stablecoins accepted for stablecoin payments.
    /// @dev Requires timelock delay if owner is TimelockController.
    function setWhitelistedTokens(address[] calldata _tokens, bool[] calldata _allowed) external onlyOwner {
        whitelistedTokens.updateAndEmit(_tokens, _allowed);
    }

    /// @dev AIFINP-33 — if _ipCreator is zero, its share goes to the merchant (no strand).
    ///      Invariant: merchantAmt + treasuryAmt + ipAmt == _total (fee-inclusive).
    function _split(
        uint256 _total,
        address _ipCreator
    ) internal view returns (uint256 merchantAmt, uint256 treasuryAmt, uint256 ipAmt) {
        if (_total < MIN_PAYMENT) revert PaymentBelowMinimum();

        treasuryAmt = (_total * treasuryBps) / BPS_DENOMINATOR;
        if (treasuryBps > 0 && treasuryAmt == 0) revert PaymentTooSmallForTreasury();

        if (_ipCreator != address(0)) {
            ipAmt = (_total * ipCreatorBps) / BPS_DENOMINATOR;
            if (ipCreatorBps > 0 && ipAmt == 0) revert PaymentTooSmallForRoyalty();
        }
        // else: ipAmt stays 0 and is absorbed into merchantAmt below (no stranded value).

        merchantAmt = _total - treasuryAmt - ipAmt;
        if (merchantAmt == 0) revert PaymentTooSmallForMerchant();
    }
}
