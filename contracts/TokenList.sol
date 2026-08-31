// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ITokenList} from "./interfaces/ITokenList.sol";
import {Whitelist} from "./Whitelist.sol";

/// @title TokenList
/// @notice Standalone whitelist registry for ERC-20 tokens accepted by a
///         downstream splitter. Access to updates is controlled by a single
///         `ADMIN_ROLE` passed at construction. The downstream splitter reads
///         the allow-list via `isAllowed(address)`.
contract TokenList is AccessControl, ITokenList {
    using Whitelist for mapping(address => bool);

    bytes32 public constant ADMIN_ROLE = DEFAULT_ADMIN_ROLE;

    mapping(address => bool) private _allowed;

    event WhitelistedTokensUpdated(address[] tokens, bool[] allowed);

    /// @param _admin Address that will hold `ADMIN_ROLE` (typically the
    ///        downstream splitter or its TimelockController).
    /// @param _initialTokens Initial list of accepted tokens. May be empty.
    constructor(address _admin, address[] memory _initialTokens) {
        _grantRole(ADMIN_ROLE, _admin);

        uint256 length = _initialTokens.length;
        if (length > 0) {
            for (uint256 i = 0; i < length; i++) {
                _allowed.set(_initialTokens[i], true);
            }
            emit WhitelistedTokensUpdated(_initialTokens, _filledArray(true, length));
        }
    }

    /// @notice Batch-update token allow-list. Only `ADMIN_ROLE`.
    function setAllowed(address[] calldata _tokens, bool[] calldata _allowedFlags) external onlyRole(ADMIN_ROLE) {
        _allowed.updateAndEmit(_tokens, _allowedFlags);
    }

    /// @notice Returns whether a token is whitelisted. Reverts for `address(0)`.
    function isAllowed(address _token) external view returns (bool) {
        return _allowed.isAllowed(_token);
    }

    function _filledArray(bool _value, uint256 _length) private pure returns (bool[] memory arr) {
        arr = new bool[](_length);
        for (uint256 i = 0; i < _length; i++) {
            arr[i] = _value;
        }
    }
}
