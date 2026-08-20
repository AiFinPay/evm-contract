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
    ZeroPaymentId,
    ZeroTreasury,
    UnsupportedToken,
    PaymentAlreadyProcessed,
    PaymentTooSmallForRoyalty,
    PaymentTooSmallForTreasury,
    TreasuryFeeTooHigh,
    IPCreatorFeeTooHigh,
    MerchantTransferFailed,
    TreasuryTransferFailed,
    IPCreatorTransferFailed
} from "./errors/Errors.sol";
import {Whitelist} from "./Whitelist.sol";

/// @title B2BSplitter v1.3 — gross-inclusive route-specific settlement
/// @notice The payer supplies one gross settlement amount. The route profile is
///         fixed forever at deployment: either AIFP-2/x402 0/0 or AIFP-1 100/0.
///         The merchant receives the remainder from the gross amount. No fee is
///         ever added on top of the quoted gross settlement amount.
/// @dev This contract intentionally changes the v1.2 ABI/semantics. It must be
///      deployed under a new address and SDK/backend routes must opt into v1.3.
contract B2BSplitterV13 is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using Whitelist for mapping(address => bool);

    /// @notice Tokens accepted for gross-inclusive stable payments. Owner can update after deployment.
    mapping(address => bool) public whitelistedTokens;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant AIFP1_TREASURY_BPS = 100;
    uint256 public constant MAX_TREASURY_BPS = 500;
    uint256 public constant MAX_IP_CREATOR_BPS = 100;

    /// @notice Immutable production economics. Valid profiles are exactly:
    ///         AIFP-2/x402 0/0; AIFP-1 merchant monetization = 100/0.
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    uint256 public immutable treasuryBps;
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    uint256 public immutable ipCreatorBps;
    address public treasury;

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
        uint256 validUntil,
        string orderId
    );
    event SplitConfigured(uint256 treasuryBps, uint256 ipCreatorBps);
    event TreasuryUpdated(address newTreasury);
    event WhitelistedTokensUpdated(address[] tokens, bool[] allowed);

    error IncorrectNativeValue(uint256 expected, uint256 received);
    error InvalidProductionSplit(uint256 treasuryBps, uint256 ipCreatorBps);
    error PaymentExpired(uint256 validUntil, uint256 currentTime);

    constructor(
        address initialOwner,
        address _treasury,
        address[] memory _stablecoins,
        uint256 _treasuryBps,
        uint256 _ipCreatorBps
    ) Ownable(initialOwner) {
        if (_treasury == address(0)) revert ZeroTreasury();
        _validateProductionSplit(_treasuryBps, _ipCreatorBps);
        treasury = _treasury;

        uint256 length = _stablecoins.length;
        address[] memory initialTokens = new address[](length);
        bool[] memory allowed = new bool[](length);
        for (uint256 i = 0; i < length; i++) {
            address token = _stablecoins[i];
            if (token != address(0)) {
                whitelistedTokens.set(token, true);
                allowed[i] = true;
            }
            initialTokens[i] = token;
        }
        emit WhitelistedTokensUpdated(initialTokens, allowed);

        treasuryBps = _treasuryBps;
        ipCreatorBps = _ipCreatorBps;
        emit SplitConfigured(_treasuryBps, _ipCreatorBps);
    }

    /// @notice Settle one exact gross amount in native token.
    /// @param _grossAmount Full payer settlement amount, excluding network gas.
    /// @param _validUntil Last block timestamp at which this quote may move value.
    function payNative(
        bytes32 _paymentId,
        address payable _merchant,
        uint256 _grossAmount,
        address _ipCreator,
        uint256 _validUntil,
        string calldata _orderId
    ) external payable nonReentrant whenNotPaused {
        _consume(_paymentId);
        _validateDeadline(_validUntil);
        if (_merchant == address(0)) revert ZeroMerchant();

        (uint256 merchantAmt, uint256 treasuryAmt, uint256 ipAmt) = _splitGross(_grossAmount, _ipCreator);
        if (msg.value != _grossAmount) {
            revert IncorrectNativeValue(_grossAmount, msg.value);
        }

        (bool s1, ) = _merchant.call{value: merchantAmt}("");
        if (!s1) revert MerchantTransferFailed();
        if (treasuryAmt > 0) {
            (bool s2, ) = payable(treasury).call{value: treasuryAmt}("");
            if (!s2) revert TreasuryTransferFailed();
        }
        if (ipAmt > 0) {
            (bool s3, ) = payable(_ipCreator).call{value: ipAmt}("");
            if (!s3) revert IPCreatorTransferFailed();
        }

        emit Payment(
            _paymentId,
            msg.sender,
            _merchant,
            address(0),
            _grossAmount,
            merchantAmt,
            treasuryAmt,
            ipAmt,
            _validUntil,
            _orderId
        );
    }

    /// @notice Settle one exact gross amount in configured USDC/USDT.
    function payStable(
        bytes32 _paymentId,
        address _token,
        uint256 _grossAmount,
        address _merchant,
        address _ipCreator,
        uint256 _validUntil,
        string calldata _orderId
    ) external nonReentrant whenNotPaused {
        _consume(_paymentId);
        _validateDeadline(_validUntil);
        if (_token == address(0) || !whitelistedTokens.isAllowed(_token)) {
            revert UnsupportedToken();
        }
        if (_merchant == address(0)) revert ZeroMerchant();

        (uint256 merchantAmt, uint256 treasuryAmt, uint256 ipAmt) = _splitGross(_grossAmount, _ipCreator);

        IERC20(_token).safeTransferFrom(msg.sender, _merchant, merchantAmt);
        if (treasuryAmt > 0) {
            IERC20(_token).safeTransferFrom(msg.sender, treasury, treasuryAmt);
        }
        if (ipAmt > 0) {
            IERC20(_token).safeTransferFrom(msg.sender, _ipCreator, ipAmt);
        }

        emit Payment(
            _paymentId,
            msg.sender,
            _merchant,
            _token,
            _grossAmount,
            merchantAmt,
            treasuryAmt,
            ipAmt,
            _validUntil,
            _orderId
        );
    }

    function quoteTotal(
        uint256 _grossAmount,
        address _ipCreator
    )
        external
        view
        returns (uint256 merchantAmount, uint256 treasuryAmount, uint256 ipCreatorAmount, uint256 totalAmount)
    {
        (merchantAmount, treasuryAmount, ipCreatorAmount) = _splitGross(_grossAmount, _ipCreator);
        totalAmount = _grossAmount;
    }

    function _consume(bytes32 _paymentId) internal {
        if (_paymentId == bytes32(0)) revert ZeroPaymentId();
        if (consumedPayment[_paymentId]) revert PaymentAlreadyProcessed();
        consumedPayment[_paymentId] = true;
    }

    function _validateDeadline(uint256 _validUntil) internal view {
        // forge-lint: disable-next-line(block-timestamp)
        if (_validUntil == 0 || block.timestamp > _validUntil) {
            revert PaymentExpired(_validUntil, block.timestamp);
        }
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

    /// @dev Production profiles are deliberately closed: no owner action can
    ///      change route economics after deployment.
    function _validateProductionSplit(uint256 _treasuryBps, uint256 _ipCreatorBps) internal pure {
        bool isAifp2 = _treasuryBps == 0 && _ipCreatorBps == 0;
        bool isAifp1 = _treasuryBps == AIFP1_TREASURY_BPS && _ipCreatorBps == 0;
        if (!isAifp1 && !isAifp2) {
            revert InvalidProductionSplit(_treasuryBps, _ipCreatorBps);
        }
        if (_treasuryBps > MAX_TREASURY_BPS) revert TreasuryFeeTooHigh();
        if (_ipCreatorBps > MAX_IP_CREATOR_BPS) revert IPCreatorFeeTooHigh();
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroTreasury();
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    /// @notice Add or remove stablecoins accepted for gross-inclusive stable payments.
    /// @dev Requires timelock delay if owner is TimelockController.
    function setWhitelistedTokens(address[] calldata _tokens, bool[] calldata _allowed) external onlyOwner {
        whitelistedTokens.updateAndEmit(_tokens, _allowed);
    }

    function _splitGross(
        uint256 _grossAmount,
        address _ipCreator
    ) internal view returns (uint256 merchantAmt, uint256 treasuryAmt, uint256 ipAmt) {
        if (_grossAmount == 0) revert ZeroAmount();

        treasuryAmt = (_grossAmount * treasuryBps) / BPS_DENOMINATOR;
        if (treasuryBps > 0 && treasuryAmt == 0) {
            revert PaymentTooSmallForTreasury();
        }

        // Production profiles pin ipCreatorBps to zero. Keep the field/event
        // shape for ABI continuity and explicit proof that creator fees are zero.
        if (_ipCreator != address(0)) {
            ipAmt = (_grossAmount * ipCreatorBps) / BPS_DENOMINATOR;
            if (ipCreatorBps > 0 && ipAmt == 0) {
                revert PaymentTooSmallForRoyalty();
            }
        }

        merchantAmt = _grossAmount - treasuryAmt - ipAmt;
        if (merchantAmt == 0) revert ZeroAmount();
    }
}
