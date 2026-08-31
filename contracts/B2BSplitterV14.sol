// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {
    ZeroAmount,
    ZeroMerchant,
    ZeroTreasury,
    UnsupportedToken,
    PaymentTooSmallForRoyalty,
    PaymentTooSmallForTreasury,
    MerchantTransferFailed,
    TreasuryTransferFailed,
    IPCreatorTransferFailed,
    IncorrectNativeValue,
    MissingIPCreator,
    InvalidSigner,
    InvalidSignature,
    InvalidSignatureLength,
    SignatureExpired,
    InvalidPayer,
    InvalidNonce,
    NonceAlreadyConsumed,
    NonceOverflow,
    InvalidTokenForNative,
    RouteDisabled,
    ZeroSigner,
    ZeroPauser,
    PauserEqualsSigner,
    AdminEqualsSigner,
    ZeroAdmin
} from "./errors/Errors.sol";
import { ITokenList } from "./interfaces/ITokenList.sol";
import { IProfiles } from "./interfaces/IProfiles.sol";
import { TokenList } from "./TokenList.sol";
import { Profiles } from "./Profiles.sol";

/// @title B2BSplitter v1.4 — signed, multi-route gross settlement
/// @notice The payer submits an EIP-712 signed quote. Route economics and the
///         stablecoin allow-list live in separate `Profiles` and `TokenList`
///         contracts. This contract orchestrates signature verification,
///         replay protection, and atomic fund splitting.
/// @dev v1.4 intentionally breaks the v1.3 ABI: payments now require a signature
///      and a routeId. It must be deployed under a new address.
contract B2BSplitterV14 is AccessControl, ReentrancyGuardTransient, Pausable, EIP712 {
    using SafeERC20 for IERC20;

    // ── Roles ────────────────────────────────────────────────────────────────────
    bytes32 public constant ADMIN_ROLE = DEFAULT_ADMIN_ROLE;
    bytes32 public constant SIGN_OPERATOR_ROLE = keccak256("SIGN_OPERATOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // ── Constants ──────────────────────────────────────────────────────────────
    uint256 public constant BPS_DENOMINATOR = 10_000;
    string public constant EIP712_NAME = "AiFinPayB2BSplitter";
    string public constant EIP712_VERSION = "1";

    // ── EIP712 type hash ─────────────────────────────────────────────────────────
    // precomputed typehash for:
    // Quote(address payer,address merchant,address token,uint256 grossAmount,
    //         address ipCreator,uint256 validUntil,bytes32 orderIdHash,uint256 nonce,bytes32 routeId)
    bytes32 private constant _QUOTE_TYPEHASH = 0xa8b0556d3a3a900bcde8265692fc8a2183d22e265f3bc658e04fe8162e02f4bf;

    // ── Satellite contracts ──────────────────────────────────────────────────────
    ITokenList public immutable tokenList;
    IProfiles public immutable profiles;

    // ── Treasury state ─────────────────────────────────────────────────────────
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

    // ── Constructor ──────────────────────────────────────────────────────────────
    struct ConstructorParams {
        address initialAdmin;
        address initialSigner;
        address initialPauser;
        address treasury;
        address[] stablecoins;
        bytes32[] routeIds;
        uint16[] treasuryBps;
        uint16[] ipCreatorBps;
    }

    constructor(ConstructorParams memory _params) EIP712(EIP712_NAME, EIP712_VERSION) {
        if (_params.initialAdmin == address(0)) revert ZeroAdmin();
        if (_params.initialSigner == address(0)) revert ZeroSigner();
        if (_params.initialPauser == address(0)) revert ZeroPauser();
        if (_params.initialAdmin == _params.initialSigner) revert AdminEqualsSigner();
        if (_params.initialPauser == _params.initialSigner) revert PauserEqualsSigner();
        if (_params.treasury == address(0)) revert ZeroTreasury();

        _grantRole(ADMIN_ROLE, _params.initialAdmin);
        _grantRole(SIGN_OPERATOR_ROLE, _params.initialSigner);
        _grantRole(PAUSER_ROLE, _params.initialPauser);

        treasury = _params.treasury;

        tokenList = ITokenList(address(new TokenList(address(this), _params.stablecoins)));
        profiles = IProfiles(
            address(new Profiles(address(this), _params.routeIds, _params.treasuryBps, _params.ipCreatorBps))
        );
    }

    // ── Settlement functions ───────────────────────────────────────────────────
    function settleNative(Quote calldata _quote, bytes calldata _signature)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        IProfiles.RouteProfile memory profile = _verifyQuote(_quote, _signature);
        if (_quote.token != address(0)) revert InvalidTokenForNative();
        if (msg.value != _quote.grossAmount) revert IncorrectNativeValue(_quote.grossAmount, msg.value);

        (uint256 merchantAmt, uint256 treasuryAmt, uint256 ipAmt) =
            _splitGross(_quote.grossAmount, profile, _quote.ipCreator);

        address routeTreasury = profile.routeTreasury == address(0) ? treasury : profile.routeTreasury;

        (bool s1,) = payable(_quote.merchant).call{ value: merchantAmt }("");
        if (!s1) revert MerchantTransferFailed();

        if (treasuryAmt > 0) {
            (bool s2,) = payable(routeTreasury).call{ value: treasuryAmt }("");
            if (!s2) revert TreasuryTransferFailed();
        }
        if (ipAmt > 0) {
            (bool s3,) = payable(_quote.ipCreator).call{ value: ipAmt }("");
            if (!s3) revert IPCreatorTransferFailed();
        }

        _emitPayment(_quote, merchantAmt, treasuryAmt, ipAmt);
    }

    function settleStable(Quote calldata _quote, bytes calldata _signature) external nonReentrant whenNotPaused {
        IProfiles.RouteProfile memory profile = _verifyQuote(_quote, _signature);
        if (_quote.token == address(0) || !tokenList.isAllowed(_quote.token)) revert UnsupportedToken();

        (uint256 merchantAmt, uint256 treasuryAmt, uint256 ipAmt) =
            _splitGross(_quote.grossAmount, profile, _quote.ipCreator);

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
    /// @notice orderIdHash is a backend correlation key only. It is signed for
    ///         integrity but the contract does not enforce idempotency on it;
    ///         uniqueness and ordering are guaranteed by `payerNonce`.
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

    function _verifyQuote(Quote calldata _quote, bytes calldata _signature)
        internal
        returns (IProfiles.RouteProfile memory profile)
    {
        if (_signature.length != 65) revert InvalidSignatureLength();
        address recovered = ECDSA.recover(digest(_quote), _signature);
        if (recovered == address(0)) revert InvalidSignature();
        if (!hasRole(SIGN_OPERATOR_ROLE, recovered)) revert InvalidSigner();

        if (block.timestamp > _quote.validUntil) revert SignatureExpired(_quote.validUntil, block.timestamp);
        if (_quote.payer == address(0) || _quote.payer != msg.sender) revert InvalidPayer();
        if (_quote.merchant == address(0)) revert ZeroMerchant();

        profile = profiles.getProfile(_quote.routeId);
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
        return keccak256(
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
    function _splitGross(uint256 _grossAmount, IProfiles.RouteProfile memory _profile, address _ipCreator)
        internal
        pure
        returns (uint256 merchantAmt, uint256 treasuryAmt, uint256 ipAmt)
    {
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

    function quoteTotal(uint256 _grossAmount, bytes32 _routeId, address _ipCreator)
        external
        view
        returns (uint256 merchantAmount, uint256 treasuryAmount, uint256 ipCreatorAmount, uint256 totalAmount)
    {
        IProfiles.RouteProfile memory profile = profiles.getProfile(_routeId);
        if (!profile.enabled) revert RouteDisabled(_routeId);
        (merchantAmount, treasuryAmount, ipCreatorAmount) = _splitGross(_grossAmount, profile, _ipCreator);
        totalAmount = _grossAmount;
    }

    // ── Governance ─────────────────────────────────────────────────────────────────
    modifier onlyAdminOrPauser() {
        if (!hasRole(ADMIN_ROLE, msg.sender) && !hasRole(PAUSER_ROLE, msg.sender)) {
            revert AccessControlUnauthorizedAccount(msg.sender, PAUSER_ROLE);
        }
        _;
    }

    /// @notice Emergency pause — can be called by either ADMIN_ROLE or PAUSER_ROLE.
    ///         The pauser is expected to be a Gnosis Safe for instant response;
    ///         unpausing remains ADMIN_ROLE-only and timelock-gated in production.
    function pause() external onlyAdminOrPauser {
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

    /// @notice Update the downstream TokenList allow-list. Only `ADMIN_ROLE`.
    function setWhitelistedTokens(address[] calldata _tokens, bool[] calldata _allowed) external onlyRole(ADMIN_ROLE) {
        tokenList.setAllowed(_tokens, _allowed);
    }

    /// @notice Configure a route in the downstream Profiles contract.
    function configureRoute(bytes32 _routeId, uint16 _treasuryBps, uint16 _ipCreatorBps, address _routeTreasury)
        external
        onlyRole(ADMIN_ROLE)
    {
        profiles.configureRoute(_routeId, _treasuryBps, _ipCreatorBps, _routeTreasury);
    }

    function disableRoute(bytes32 _routeId) external onlyRole(ADMIN_ROLE) {
        profiles.disableRoute(_routeId);
    }

    function enableRoute(bytes32 _routeId) external onlyRole(ADMIN_ROLE) {
        profiles.enableRoute(_routeId);
    }

    function grantSignerRole(address _account) external onlyRole(ADMIN_ROLE) {
        if (_account == address(0)) revert ZeroSigner();
        grantRole(SIGN_OPERATOR_ROLE, _account);
    }

    function revokeSignerRole(address _account) external onlyRole(ADMIN_ROLE) {
        _revokeRole(SIGN_OPERATOR_ROLE, _account);
    }

    function grantPauserRole(address _account) external onlyRole(ADMIN_ROLE) {
        if (_account == address(0)) revert ZeroPauser();
        grantRole(PAUSER_ROLE, _account);
    }

    function revokePauserRole(address _account) external onlyRole(ADMIN_ROLE) {
        _revokeRole(PAUSER_ROLE, _account);
    }

    /// @dev Enforce role separation on every public grant path, including the
    ///      convenience wrappers. Keeps ADMIN/SIGN/PAUSER holders mutually
    ///      exclusive except for the explicit overlap of ADMIN and PAUSER.
    function grantRole(bytes32 _role, address _account) public override {
        if (_role == SIGN_OPERATOR_ROLE) {
            if (hasRole(ADMIN_ROLE, _account) || hasRole(PAUSER_ROLE, _account)) revert AdminEqualsSigner();
        } else if (_role == ADMIN_ROLE) {
            if (hasRole(SIGN_OPERATOR_ROLE, _account) || hasRole(PAUSER_ROLE, _account)) revert AdminEqualsSigner();
        } else if (_role == PAUSER_ROLE) {
            if (hasRole(SIGN_OPERATOR_ROLE, _account)) revert PauserEqualsSigner();
        }
        super.grantRole(_role, _account);
    }

    // ── Internal helpers ─────────────────────────────────────────────────────────
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
