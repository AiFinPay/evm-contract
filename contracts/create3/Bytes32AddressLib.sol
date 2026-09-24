// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.35;

/// @notice Sourced from Solmate (https://github.com/transmissions11/solmate).
/// @notice Library for converting a bytes32 to an address.
library Bytes32AddressLib {
    /// @notice Returns the last 20 bytes of a bytes32 value as an address.
    function fromLast20Bytes(bytes32 _bytesValue) internal pure returns (address) {
        return address(uint160(uint256(_bytesValue)));
    }
}
