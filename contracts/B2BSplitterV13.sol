// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
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
contract B2BSplitterV13 is Ownable, ReentrancyGuardTransient, Pausable {
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
    event SplitConfigured(uint256 indexed treasuryBps, uint256 indexed ipCreatorBps);
    event TreasuryUpdated(address indexed newTreasury);
    event WhitelistedTokensUpdated(address[] tokens, bool[] allowed);

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

    error IncorrectNativeValue(uint256 expected, uint256 received);
    error InvalidProductionSplit(uint256 treasuryBps, uint256 ipCreatorBps);
    error PaymentExpired(uint256 validUntil, uint256 currentTime);
    error MissingIPCreator();
    error ZeroStablecoins();

    constructor(ConstructorParams memory _params) Ownable(_params.initialOwner) {
        if (_params.treasury == address(0)) revert ZeroTreasury();
        _validateProductionSplit(_params.treasuryBps, _params.ipCreatorBps);
        treasury = _params.treasury;

        address[] memory stablecoins = _params.stablecoins;
        uint256 length = stablecoins.length;
        if (length == 0) revert ZeroStablecoins();
        uint256 nonZeroCount = 0;
        for (uint256 i = 0; i < length; i++) {
            address token = stablecoins[i];
            if (token != address(0)) {
                whitelistedTokens.set(token, true);
                unchecked {
                    ++nonZeroCount;
                }
            }
        }

        treasuryBps = _params.treasuryBps;
        ipCreatorBps = _params.ipCreatorBps;
        emit SplitConfigured(_params.treasuryBps, _params.ipCreatorBps);

        if (nonZeroCount > 0) {
            address[] memory emittedTokens = new address[](nonZeroCount);
            bool[] memory emittedAllowed = new bool[](nonZeroCount);
            uint256 j = 0;
            for (uint256 i = 0; i < length;) {
                address token = stablecoins[i];
                if (token != address(0)) {
                    emittedTokens[j] = token;
                    emittedAllowed[j] = true;
                    unchecked {
                        ++j;
                    }
                }
                unchecked {
                    ++i;
                }
            }
            emit WhitelistedTokensUpdated(emittedTokens, emittedAllowed);
        }
    }

    /// @notice Settle one exact gross amount in native token.
    /// @param _payment Payment details. `merchant` receives the remainder; `grossAmount` must match
    ///                   `msg.value`.
    function payNative(NativePayment calldata _payment) external payable nonReentrant whenNotPaused {
        bytes32 paymentId = _payment.paymentId;
        address merchant = _payment.merchant;
        uint256 grossAmount = _payment.grossAmount;
        address ipCreator = _payment.ipCreator;
        uint256 validUntil = _payment.validUntil;
        string memory orderId = _payment.orderId;

        _consume(paymentId);
        _validateDeadline(validUntil);
        if (merchant == address(0)) revert ZeroMerchant();

        if (msg.value != grossAmount) revert IncorrectNativeValue(grossAmount, msg.value);
        (uint256 merchantAmt, uint256 treasuryAmt, uint256 ipAmt) = _splitGross(grossAmount, ipCreator);

        (bool s1, ) = merchant.call{value: merchantAmt}("");
        if (!s1) revert MerchantTransferFailed();

        address cachedTreasury = treasury;
        if (treasuryAmt > 0) {
            (bool s2, ) = payable(cachedTreasury).call{value: treasuryAmt}("");
            if (!s2) revert TreasuryTransferFailed();
        }
        if (ipAmt > 0) {
            (bool s3, ) = payable(ipCreator).call{value: ipAmt}("");
            if (!s3) revert IPCreatorTransferFailed();
        }

        emit Payment(
            paymentId,
            msg.sender,
            merchant,
            address(0),
            grossAmount,
            merchantAmt,
            treasuryAmt,
            ipAmt,
            validUntil,
            orderId
        );
    }

    /// @notice Settle one exact gross amount in configured USDC/USDT.
    /// @param _payment Payment details. `token` must be whitelisted; `grossAmount` must be approved by
    ///                   `msg.sender`.
    function payStable(StablePayment calldata _payment) external nonReentrant whenNotPaused {
        bytes32 paymentId = _payment.paymentId;
        address token = _payment.token;
        uint256 grossAmount = _payment.grossAmount;
        address merchant = _payment.merchant;
        address ipCreator = _payment.ipCreator;
        uint256 validUntil = _payment.validUntil;
        string memory orderId = _payment.orderId;

        _consume(paymentId);
        _validateDeadline(validUntil);
        if (token == address(0) || !whitelistedTokens.isAllowed(token)) revert UnsupportedToken();
        if (merchant == address(0)) revert ZeroMerchant();

        (uint256 merchantAmt, uint256 treasuryAmt, uint256 ipAmt) = _splitGross(grossAmount, ipCreator);

        address cachedTreasury = treasury;
        IERC20 tokenContract = IERC20(token);
        tokenContract.safeTransferFrom(msg.sender, merchant, merchantAmt);
        if (treasuryAmt > 0) {
            tokenContract.safeTransferFrom(msg.sender, cachedTreasury, treasuryAmt);
        }
        if (ipAmt > 0) {
            tokenContract.safeTransferFrom(msg.sender, ipCreator, ipAmt);
        }

        emit Payment(
            paymentId,
            msg.sender,
            merchant,
            token,
            grossAmount,
            merchantAmt,
            treasuryAmt,
            ipAmt,
            validUntil,
            orderId
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
    /// @dev The owner is trusted to whitelist only "clean" ERC20s (no
    ///      fee-on-transfer, no rebasing, no balance-modifying hooks). This
    ///      assumption is enforced operationally by the timelock + multisig
    ///      governance (see `docs/TIMELOCK_SETUP.md`).
    ///      Requires timelock delay if owner is TimelockController.
    function setWhitelistedTokens(address[] calldata _tokens, bool[] calldata _allowed) external onlyOwner {
        whitelistedTokens.updateAndEmit(_tokens, _allowed);
    }

    /// @dev Production profiles are pinned at construction (AIFP-2 0/0 or AIFP-1
    ///      100/0) by `_validateProductionSplit`. The post-split merchant leg
    ///      is therefore guaranteed non-zero for any non-zero gross amount when
    ///      treasuryBps < BPS_DENOMINATOR and ipCreatorBps < BPS_DENOMINATOR,
    ///      which is enforced by the MAX_*_BPS caps. This routine additionally
    ///      refuses to silently drop the creator leg: if a future profile enables
    ///      ipCreatorBps > 0, a missing creator address reverts rather than
    ///      redirecting value to the merchant.
    function _splitGross(
        uint256 _grossAmount,
        address _ipCreator
    ) internal view returns (uint256 merchantAmt, uint256 treasuryAmt, uint256 ipAmt) {
        if (_grossAmount == 0) revert ZeroAmount();

        uint256 feeBps = treasuryBps;
        if (feeBps > 0) {
            treasuryAmt = (_grossAmount * feeBps) / BPS_DENOMINATOR;
            if (treasuryAmt == 0) revert PaymentTooSmallForTreasury();
        }

        uint256 creatorBps = ipCreatorBps;
        if (creatorBps > 0) {
            if (_ipCreator == address(0)) revert MissingIPCreator();
            ipAmt = (_grossAmount * creatorBps) / BPS_DENOMINATOR;
            if (ipAmt == 0) revert PaymentTooSmallForRoyalty();
        }

        merchantAmt = _grossAmount - treasuryAmt - ipAmt;
        if (merchantAmt == 0) revert ZeroAmount();
    }
}
