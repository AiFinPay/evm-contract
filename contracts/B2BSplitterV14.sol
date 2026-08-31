// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {
    ZeroAmount,
    ZeroMerchant,
    ZeroTreasury,
    UnsupportedToken,
    PaymentTooSmallForRoyalty,
    PaymentTooSmallForTreasury,
    TreasuryFeeTooHigh,
    IPCreatorFeeTooHigh,
    MerchantTransferFailed,
    TreasuryTransferFailed,
    IPCreatorTransferFailed,
    IncorrectNativeValue,
    MissingIPCreator,
    ZeroStablecoins,
    InvalidSigner,
    InvalidSignature,
    InvalidSignatureLength,
    SignatureExpired,
    InvalidPayer,
    InvalidNonce,
    NonceAlreadyConsumed,
    NonceOverflow,
    InvalidTokenForNative,
    UnknownRoute,
    RouteDisabled,
    RouteAlreadyExists,
    ZeroSigner,
    AdminEqualsSigner,
    ZeroAdmin,
    ArrayLengthMismatch,
    RouteNotFound
} from "./errors/Errors.sol";
import {Whitelist} from "./Whitelist.sol";

/// @title B2BSplitter v1.4 — signed, multi-route gross settlement
/// @notice The payer submits an EIP-712 signed quote. The route profile is selected
///         at settlement time by `routeId`. ADMIN_ROLE governs the contract;
///         SIGN_OPERATOR_ROLE signs quotes. Roles are deliberately orthogonal.
/// @dev v1.4 intentionally breaks the v1.3 ABI: payments now require a signature
///      and a routeId. It must be deployed under a new address.
contract B2BSplitterV14 is AccessControl, Ownable2Step, ReentrancyGuardTransient, Pausable, EIP712 {
    using SafeERC20 for IERC20;
    using Whitelist for mapping(address => bool);

    // ── Roles ────────────────────────────────────────────────────────────────────
    bytes32 public constant ADMIN_ROLE = DEFAULT_ADMIN_ROLE;
    bytes32 public constant SIGN_OPERATOR_ROLE = keccak256("SIGN_OPERATOR_ROLE");

    // ── Constants ──────────────────────────────────────────────────────────────
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_TREASURY_BPS = 500;
    uint256 public constant MAX_IP_CREATOR_BPS = 100;
    string public constant EIP712_NAME = "AiFinPayB2BSplitter";
    string public constant EIP712_VERSION = "1";

    // ── EIP712 type hash ─────────────────────────────────────────────────────────
    // precomputed typehash for:
    // Quote(address payer,address merchant,address token,uint256 grossAmount,
    //         address ipCreator,uint256 validUntil,bytes32 orderIdHash,uint256 nonce,bytes32 routeId)
    bytes32 private constant _QUOTE_TYPEHASH = 0xa8b0556d3a3a900bcde8265692fc8a2183d22e265f3bc658e04fe8162e02f4bf;

    // ── Multi-route profile storage ──────────────────────────────────────────────
    struct RouteProfile {
        uint16 treasuryBps;
        uint16 ipCreatorBps;
        bool enabled;
        uint64 configuredAt;
        address routeTreasury;
    }

    mapping(bytes32 => RouteProfile) public profiles;
    bytes32[] public enabledRouteIds;

    // ── Token + treasury state ───────────────────────────────────────────────────
    mapping(address => bool) public whitelistedTokens;
    address public treasury;

    // ── Replay protection ──────────────────────────────────────────────────────
    mapping(address => uint256) public payerNonce;
    mapping(address => mapping(uint256 => bool)) public consumedNonce;

    // ── Events ───────────────────────────────────────────────────────────────────
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
    event TreasuryUpdated(address indexed newTreasury);
    event WhitelistedTokensUpdated(address[] tokens, bool[] allowed);
    event RouteConfigured(
        bytes32 indexed routeId,
        uint16 treasuryBps,
        uint16 ipCreatorBps,
        address indexed routeTreasury
    );
    event RouteStatusChanged(bytes32 indexed routeId, bool indexed enabled);

    // ── Constructor ──────────────────────────────────────────────────────────────
    struct ConstructorParams {
        address initialAdmin;
        address initialSigner;
        address treasury;
        address[] stablecoins;
        bytes32[] routeIds;
        uint16[] treasuryBps;
        uint16[] ipCreatorBps;
    }

    constructor(ConstructorParams memory _params) EIP712(EIP712_NAME, EIP712_VERSION) Ownable(_params.initialAdmin) {
        if (_params.initialAdmin == address(0)) revert ZeroAdmin();
        if (_params.initialSigner == address(0)) revert ZeroSigner();
        if (_params.initialAdmin == _params.initialSigner) revert AdminEqualsSigner();
        if (_params.treasury == address(0)) revert ZeroTreasury();

        _grantRole(ADMIN_ROLE, _params.initialAdmin);
        _grantRole(SIGN_OPERATOR_ROLE, _params.initialSigner);

        treasury = _params.treasury;

        _initStablecoins(_params.stablecoins);
        _initRoutes(_params.routeIds, _params.treasuryBps, _params.ipCreatorBps);
    }

    function _initStablecoins(address[] memory _stablecoins) internal {
        uint256 length = _stablecoins.length;
        if (length == 0) revert ZeroStablecoins();
        for (uint256 i = 0; i < length; i++) {
            if (_stablecoins[i] != address(0)) {
                whitelistedTokens.set(_stablecoins[i], true);
            }
        }
        address[] memory emittedTokens = new address[](length);
        bool[] memory emittedAllowed = new bool[](length);
        for (uint256 i = 0; i < length; i++) {
            emittedTokens[i] = _stablecoins[i];
            emittedAllowed[i] = _stablecoins[i] != address(0);
        }
        emit WhitelistedTokensUpdated(emittedTokens, emittedAllowed);
    }

    function _initRoutes(
        bytes32[] memory _routeIds,
        uint16[] memory _treasuryBps,
        uint16[] memory _ipCreatorBps
    ) internal {
        uint256 routeCount = _routeIds.length;
        if (routeCount == 0) revert RouteNotFound(0);
        if (routeCount != _treasuryBps.length || routeCount != _ipCreatorBps.length) {
            revert ArrayLengthMismatch();
        }

        for (uint256 i = 0; i < routeCount; i++) {
            bytes32 routeId = _routeIds[i];
            uint16 tBps = _treasuryBps[i];
            uint16 iBps = _ipCreatorBps[i];
            if (profiles[routeId].configuredAt != 0) revert RouteAlreadyExists(routeId);
            _validateProfileBps(tBps, iBps);

            profiles[routeId] = RouteProfile({
                treasuryBps: tBps,
                ipCreatorBps: iBps,
                enabled: true,
                configuredAt: uint64(block.timestamp),
                routeTreasury: address(0)
            });
            enabledRouteIds.push(routeId);
            emit RouteConfigured(routeId, tBps, iBps, address(0));
        }
    }

    // ── Settlement functions ───────────────────────────────────────────────────
    function settleNative(
        Quote calldata _quote,
        bytes calldata _signature
    ) external payable nonReentrant whenNotPaused {
        _verifyQuote(_quote, _signature);
        if (_quote.token != address(0)) revert InvalidTokenForNative();
        if (msg.value != _quote.grossAmount) revert IncorrectNativeValue(_quote.grossAmount, msg.value);

        RouteProfile memory profile = profiles[_quote.routeId];
        (uint256 merchantAmt, uint256 treasuryAmt, uint256 ipAmt) = _splitGross(
            _quote.grossAmount,
            profile,
            _quote.ipCreator
        );

        address routeTreasury = profile.routeTreasury == address(0) ? treasury : profile.routeTreasury;

        (bool s1, ) = payable(_quote.merchant).call{value: merchantAmt}("");
        if (!s1) revert MerchantTransferFailed();

        if (treasuryAmt > 0) {
            (bool s2, ) = payable(routeTreasury).call{value: treasuryAmt}("");
            if (!s2) revert TreasuryTransferFailed();
        }
        if (ipAmt > 0) {
            (bool s3, ) = payable(_quote.ipCreator).call{value: ipAmt}("");
            if (!s3) revert IPCreatorTransferFailed();
        }

        _emitPayment(_quote, merchantAmt, treasuryAmt, ipAmt);
    }

    function settleStable(Quote calldata _quote, bytes calldata _signature) external nonReentrant whenNotPaused {
        _verifyQuote(_quote, _signature);
        if (_quote.token == address(0) || !whitelistedTokens.isAllowed(_quote.token)) revert UnsupportedToken();

        RouteProfile memory profile = profiles[_quote.routeId];
        (uint256 merchantAmt, uint256 treasuryAmt, uint256 ipAmt) = _splitGross(
            _quote.grossAmount,
            profile,
            _quote.ipCreator
        );

        address routeTreasury = profile.routeTreasury == address(0) ? treasury : profile.routeTreasury;
        IERC20 tokenContract = IERC20(_quote.token);

        tokenContract.safeTransferFrom(msg.sender, _quote.merchant, merchantAmt);
        if (treasuryAmt > 0) {
            tokenContract.safeTransferFrom(msg.sender, routeTreasury, treasuryAmt);
        }
        if (ipAmt > 0) {
            tokenContract.safeTransferFrom(msg.sender, _quote.ipCreator, ipAmt);
        }

        _emitPayment(_quote, merchantAmt, treasuryAmt, ipAmt);
    }

    // ── Quote verification ───────────────────────────────────────────────────────
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

    function _verifyQuote(Quote calldata _quote, bytes calldata _signature) internal {
        if (_signature.length != 65) revert InvalidSignatureLength();
        address recovered = ECDSA.recover(digest(_quote), _signature);
        if (recovered == address(0)) revert InvalidSignature();
        if (!hasRole(SIGN_OPERATOR_ROLE, recovered)) revert InvalidSigner();

        if (block.timestamp > _quote.validUntil) revert SignatureExpired(_quote.validUntil, block.timestamp);
        if (_quote.payer == address(0) || _quote.payer != msg.sender) revert InvalidPayer();
        if (_quote.merchant == address(0)) revert ZeroMerchant();

        RouteProfile memory profile = profiles[_quote.routeId];
        if (profile.configuredAt == 0) revert UnknownRoute(_quote.routeId);
        if (!profile.enabled) revert RouteDisabled(_quote.routeId);

        if (_quote.nonce != payerNonce[_quote.payer]) revert InvalidNonce();
        if (consumedNonce[_quote.payer][_quote.nonce]) revert NonceAlreadyConsumed();

        uint256 nextNonce;
        unchecked {
            nextNonce = _quote.nonce + 1;
        }
        if (nextNonce < _quote.nonce) revert NonceOverflow();

        payerNonce[_quote.payer] = nextNonce;
        consumedNonce[_quote.payer][_quote.nonce] = true;
    }

    // ── EIP-712 helpers ──────────────────────────────────────────────────────────
    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function digest(Quote calldata _quote) public view returns (bytes32) {
        return _hashTypedDataV4(quoteHash(_quote));
    }

    function quoteHash(Quote calldata _quote) public pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    _QUOTE_TYPEHASH,
                    _quote.payer,
                    _quote.merchant,
                    _quote.token,
                    _quote.grossAmount,
                    _quote.ipCreator,
                    _quote.validUntil,
                    _quote.orderIdHash,
                    _quote.nonce,
                    _quote.routeId
                )
            );
    }

    // ── Splitting logic ──────────────────────────────────────────────────────────
    function _splitGross(
        uint256 _grossAmount,
        RouteProfile memory _profile,
        address _ipCreator
    ) internal pure returns (uint256 merchantAmt, uint256 treasuryAmt, uint256 ipAmt) {
        if (_grossAmount == 0) revert ZeroAmount();

        uint256 feeBps = _profile.treasuryBps;
        if (feeBps > 0) {
            treasuryAmt = (_grossAmount * feeBps) / BPS_DENOMINATOR;
            if (treasuryAmt == 0) revert PaymentTooSmallForTreasury();
        }

        uint256 creatorBps = _profile.ipCreatorBps;
        if (creatorBps > 0) {
            if (_ipCreator == address(0)) revert MissingIPCreator();
            ipAmt = (_grossAmount * creatorBps) / BPS_DENOMINATOR;
            if (ipAmt == 0) revert PaymentTooSmallForRoyalty();
        }

        merchantAmt = _grossAmount - treasuryAmt - ipAmt;
        if (merchantAmt == 0) revert ZeroAmount();
    }

    function quoteTotal(
        uint256 _grossAmount,
        bytes32 _routeId,
        address _ipCreator
    )
        external
        view
        returns (uint256 merchantAmount, uint256 treasuryAmount, uint256 ipCreatorAmount, uint256 totalAmount)
    {
        RouteProfile memory profile = profiles[_routeId];
        if (profile.configuredAt == 0) revert UnknownRoute(_routeId);
        (merchantAmount, treasuryAmount, ipCreatorAmount) = _splitGross(_grossAmount, profile, _ipCreator);
        totalAmount = _grossAmount;
    }

    // ── Governance ─────────────────────────────────────────────────────────────────
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    function setTreasury(address _treasury) external onlyRole(ADMIN_ROLE) {
        if (_treasury == address(0)) revert ZeroTreasury();
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function setWhitelistedTokens(address[] calldata _tokens, bool[] calldata _allowed) external onlyRole(ADMIN_ROLE) {
        whitelistedTokens.updateAndEmit(_tokens, _allowed);
    }

    function configureRoute(
        bytes32 _routeId,
        uint16 _treasuryBps,
        uint16 _ipCreatorBps,
        address _routeTreasury
    ) external onlyRole(ADMIN_ROLE) {
        _validateProfileBps(_treasuryBps, _ipCreatorBps);
        RouteProfile storage profile = profiles[_routeId];
        if (profile.configuredAt == 0) {
            profile.enabled = true;
            profile.configuredAt = uint64(block.timestamp);
            enabledRouteIds.push(_routeId);
        }
        profile.treasuryBps = _treasuryBps;
        profile.ipCreatorBps = _ipCreatorBps;
        profile.routeTreasury = _routeTreasury;
        emit RouteConfigured(_routeId, _treasuryBps, _ipCreatorBps, _routeTreasury);
    }

    function disableRoute(bytes32 _routeId) external onlyRole(ADMIN_ROLE) {
        RouteProfile storage profile = profiles[_routeId];
        if (profile.configuredAt == 0) revert UnknownRoute(_routeId);
        profile.enabled = false;
        emit RouteStatusChanged(_routeId, false);
    }

    function enableRoute(bytes32 _routeId) external onlyRole(ADMIN_ROLE) {
        RouteProfile storage profile = profiles[_routeId];
        if (profile.configuredAt == 0) revert UnknownRoute(_routeId);
        profile.enabled = true;
        emit RouteStatusChanged(_routeId, true);
    }

    function grantSignerRole(address _account) external onlyRole(ADMIN_ROLE) {
        if (_account == address(0)) revert ZeroSigner();
        _grantRole(SIGN_OPERATOR_ROLE, _account);
    }

    function revokeSignerRole(address _account) external onlyRole(ADMIN_ROLE) {
        _revokeRole(SIGN_OPERATOR_ROLE, _account);
    }

    // ── Internal helpers ─────────────────────────────────────────────────────────
    function _validateProfileBps(uint16 _treasuryBps, uint16 _ipCreatorBps) internal pure {
        if (_treasuryBps > MAX_TREASURY_BPS) revert TreasuryFeeTooHigh();
        if (_ipCreatorBps > MAX_IP_CREATOR_BPS) revert IPCreatorFeeTooHigh();
    }

    function _emitPayment(Quote calldata _quote, uint256 _merchantAmt, uint256 _treasuryAmt, uint256 _ipAmt) internal {
        bytes32 paymentId = keccak256(
            abi.encode(
                _quote.payer,
                _quote.merchant,
                _quote.token,
                _quote.grossAmount,
                _quote.ipCreator,
                _quote.validUntil,
                _quote.orderIdHash,
                _quote.nonce,
                _quote.routeId
            )
        );
        emit Payment(
            paymentId,
            _quote.payer,
            _quote.merchant,
            _quote.token,
            _quote.grossAmount,
            _merchantAmt,
            _treasuryAmt,
            _ipAmt,
            _quote.validUntil,
            _quote.routeId,
            _quote.orderIdHash
        );
    }
}
