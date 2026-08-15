// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./errors/Errors.sol";

/// @title B2BSplitter v1.3 — gross-inclusive route-specific settlement
/// @notice The payer supplies one gross settlement amount. Configured protocol
///         and optional creator fees are deducted from that gross amount and the
///         merchant receives the remainder. No configured fee is added on top.
/// @dev This contract intentionally changes the v1.2 ABI/semantics. It must be
///      deployed under a new address and SDK/backend routes must opt into v1.3.
contract B2BSplitterV13 is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    address public immutable USDC;
    address public immutable USDT;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_TOTAL_FEE_BPS = 500;

    uint256 public treasuryBps;
    uint256 public ipCreatorBps;
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
    event SplitUpdated(uint256 treasuryBps, uint256 ipCreatorBps);
    event TreasuryUpdated(address newTreasury);

    error IncorrectNativeValue(uint256 expected, uint256 received);
    error FeesExceedMaximum(uint256 provided, uint256 maximum);
    error PaymentExpired(uint256 validUntil, uint256 currentTime);

    constructor(
        address initialOwner,
        address _treasury,
        address _usdc,
        address _usdt,
        uint256 _treasuryBps,
        uint256 _ipCreatorBps
    ) Ownable(initialOwner) {
        if (_treasury == address(0)) revert ZeroTreasury();
        _validateSplit(_treasuryBps, _ipCreatorBps);
        treasury = _treasury;
        USDC = _usdc;
        USDT = _usdt;
        treasuryBps = _treasuryBps;
        ipCreatorBps = _ipCreatorBps;
        emit SplitUpdated(_treasuryBps, _ipCreatorBps);
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
        if (_token == address(0) || (_token != USDC && _token != USDT)) {
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
        if (_validUntil == 0 || block.timestamp > _validUntil) {
            revert PaymentExpired(_validUntil, block.timestamp);
        }
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setSplit(uint256 _treasuryBps, uint256 _ipCreatorBps) external onlyOwner {
        _validateSplit(_treasuryBps, _ipCreatorBps);
        treasuryBps = _treasuryBps;
        ipCreatorBps = _ipCreatorBps;
        emit SplitUpdated(_treasuryBps, _ipCreatorBps);
    }

    function _validateSplit(uint256 _treasuryBps, uint256 _ipCreatorBps) internal pure {
        uint256 total = _treasuryBps + _ipCreatorBps;
        if (total > MAX_TOTAL_FEE_BPS) {
            revert FeesExceedMaximum(total, MAX_TOTAL_FEE_BPS);
        }
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroTreasury();
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
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
