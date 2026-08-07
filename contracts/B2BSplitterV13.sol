// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./errors/Errors.sol";

/// @title B2BSplitter v1.3 — explicit fee-on-top settlement
/// @notice The merchant amount is the quoted commercial price. AiFinPay and
///         optional creator fees are calculated from that merchant amount and
///         paid on top, so the merchant receives the full quote exactly.
/// @dev This contract intentionally changes the v1.2 ABI. It must be deployed
///      under a new address and SDK/backend routes must opt into version 1.3.
contract B2BSplitterV13 is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    address public immutable USDC;
    address public immutable USDT;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MIN_MERCHANT_AMOUNT = 100_000;

    uint256 public treasuryBps = 100;
    uint256 public ipCreatorBps = 1;
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
        string orderId
    );
    event SplitUpdated(uint256 treasuryBps, uint256 ipCreatorBps);
    event TreasuryUpdated(address newTreasury);

    error IncorrectNativeValue(uint256 expected, uint256 received);

    constructor(address initialOwner, address _treasury, address _usdc, address _usdt) Ownable(initialOwner) {
        if (_treasury == address(0)) revert ZeroTreasury();
        treasury = _treasury;
        USDC = _usdc;
        USDT = _usdt;
    }

    /// @notice Pay an exact quoted merchant amount in native token.
    /// @param _merchantAmount Amount the merchant quoted and must receive in full.
    /// @dev msg.value must equal merchantAmount + protocol fee + creator fee.
    function payNative(
        bytes32 _paymentId,
        address payable _merchant,
        uint256 _merchantAmount,
        address _ipCreator,
        string calldata _orderId
    ) external payable nonReentrant whenNotPaused {
        _consume(_paymentId);
        if (_merchant == address(0)) revert ZeroMerchant();

        (uint256 treasuryAmt, uint256 ipAmt, uint256 totalAmt) = _feeOnTop(_merchantAmount, _ipCreator);
        if (msg.value != totalAmt) revert IncorrectNativeValue(totalAmt, msg.value);

        (bool s1, ) = _merchant.call{value: _merchantAmount}("");
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
            totalAmt,
            _merchantAmount,
            treasuryAmt,
            ipAmt,
            _orderId
        );
    }

    /// @notice Pay an exact quoted merchant amount in configured USDC/USDT.
    /// @dev Caller approves the calculated totalAmount, not merely merchantAmount.
    function payStable(
        bytes32 _paymentId,
        address _token,
        uint256 _merchantAmount,
        address _merchant,
        address _ipCreator,
        string calldata _orderId
    ) external nonReentrant whenNotPaused {
        _consume(_paymentId);
        if (_token == address(0) || (_token != USDC && _token != USDT)) revert UnsupportedToken();
        if (_merchant == address(0)) revert ZeroMerchant();

        (uint256 treasuryAmt, uint256 ipAmt, uint256 totalAmt) = _feeOnTop(_merchantAmount, _ipCreator);

        IERC20(_token).safeTransferFrom(msg.sender, _merchant, _merchantAmount);
        IERC20(_token).safeTransferFrom(msg.sender, treasury, treasuryAmt);
        if (ipAmt > 0) {
            IERC20(_token).safeTransferFrom(msg.sender, _ipCreator, ipAmt);
        }

        emit Payment(
            _paymentId,
            msg.sender,
            _merchant,
            _token,
            totalAmt,
            _merchantAmount,
            treasuryAmt,
            ipAmt,
            _orderId
        );
    }

    function quoteTotal(
        uint256 _merchantAmount,
        address _ipCreator
    ) external view returns (uint256 merchantAmount, uint256 treasuryAmount, uint256 ipCreatorAmount, uint256 totalAmount) {
        (treasuryAmount, ipCreatorAmount, totalAmount) = _feeOnTop(_merchantAmount, _ipCreator);
        merchantAmount = _merchantAmount;
    }

    function _consume(bytes32 _paymentId) internal {
        if (_paymentId == bytes32(0)) revert ZeroPaymentId();
        if (consumedPayment[_paymentId]) revert PaymentAlreadyProcessed();
        consumedPayment[_paymentId] = true;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setSplit(uint256 _treasuryBps, uint256 _ipCreatorBps) external onlyOwner {
        if (_treasuryBps + _ipCreatorBps >= BPS_DENOMINATOR) revert FeesExceed100();
        if (_treasuryBps < 1) revert TreasuryFeeTooLow();
        treasuryBps = _treasuryBps;
        ipCreatorBps = _ipCreatorBps;
        emit SplitUpdated(_treasuryBps, _ipCreatorBps);
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroTreasury();
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    /// @dev Fees are percentages of merchantAmount, never percentages of total.
    ///      If no creator is supplied, no creator fee is charged; the merchant
    ///      still receives exactly merchantAmount.
    function _feeOnTop(
        uint256 _merchantAmount,
        address _ipCreator
    ) internal view returns (uint256 treasuryAmt, uint256 ipAmt, uint256 totalAmt) {
        if (_merchantAmount < MIN_MERCHANT_AMOUNT) revert PaymentBelowMinimum();

        treasuryAmt = (_merchantAmount * treasuryBps) / BPS_DENOMINATOR;
        if (treasuryBps > 0 && treasuryAmt == 0) revert PaymentTooSmallForTreasury();

        if (_ipCreator != address(0)) {
            ipAmt = (_merchantAmount * ipCreatorBps) / BPS_DENOMINATOR;
            if (ipCreatorBps > 0 && ipAmt == 0) revert PaymentTooSmallForRoyalty();
        }

        totalAmt = _merchantAmount + treasuryAmt + ipAmt;
    }
}
