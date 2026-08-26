// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ZeroAddress, ArrayLengthMismatch} from "./errors/Errors.sol";

/// @title Whitelist — reusable stablecoin allow-list
/// @notice Generic mapping-based whitelist used by AiFinPayCore and B2BSplitter
///         contracts. Maintains a `mapping(address => bool)` and exposes
///         batched add/remove with zero-address validation and event emission.
library Whitelist {
    event WhitelistedTokensUpdated(address[] tokens, bool[] allowed);

    /// @notice Set the allowed flag for a single token.
    function set(mapping(address => bool) storage _map, address _token, bool _allowed) internal {
        if (_token == address(0)) revert ZeroAddress();
        _map[_token] = _allowed;
    }

    /// @notice Batch update token allow-list. Arrays must be the same length.
    function setMany(
        mapping(address => bool) storage _map,
        address[] calldata _tokens,
        bool[] calldata _allowed
    ) internal {
        if (_tokens.length != _allowed.length) revert ArrayLengthMismatch();
        for (uint256 i = 0; i < _tokens.length; i++) {
            set(_map, _tokens[i], _allowed[i]);
        }
    }

    /// @notice Convenience wrapper: batch-update and emit the canonical event.
    function updateAndEmit(
        mapping(address => bool) storage _map,
        address[] calldata _tokens,
        bool[] calldata _allowed
    ) internal {
        setMany(_map, _tokens, _allowed);
        emit WhitelistedTokensUpdated(_tokens, _allowed);
    }

    /// @notice Returns whether the token is in the allow-list.
    function isAllowed(mapping(address => bool) storage _map, address _token) internal view returns (bool) {
        return _map[_token];
    }
}
