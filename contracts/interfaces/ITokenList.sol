// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title ITokenList
/// @notice Minimal surface of a token allow-list used by a downstream splitter.
interface ITokenList {
    /// @notice Batch-update token allow-list. Only the list admin.
    function setAllowed(address[] calldata _tokens, bool[] calldata _allowedFlags) external;

    /// @notice Returns whether a token is whitelisted.
    function isAllowed(address _token) external view returns (bool);
}
