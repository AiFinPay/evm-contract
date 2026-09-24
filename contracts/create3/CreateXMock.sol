// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { ICreateX } from "./ICreateX.sol";
import { CREATE3 } from "./CREATE3.sol";

/// @title CreateXMock
/// @notice Minimal local stand-in for the canonical CreateX factory. It
///         implements only the two ICreateX functions we need for tests:
///         `deployCreate3` and `computeCreate3Address`. It mirrors CreateX's
///         salt guarding for the case where the first 20 bytes of the salt
///         equal the deployer address and the 21st byte is `0x00`.
/// @dev This contract exists solely for local EDR/Hardhat tests. Production
///      networks use the canonical `0xba5Ed...ba5Ed` CreateX address.
contract CreateXMock is ICreateX {
    /// @inheritdoc ICreateX
    /// @notice Expects the raw salt (with deployer prefix). CreateX guards it.
    function deployCreate3(
        bytes32 _salt,
        bytes calldata _initCode
    ) external payable override returns (address newContract) {
        return CREATE3.deploy(_guard(_salt), _initCode, msg.value);
    }

    /// @inheritdoc ICreateX
    /// @notice Expects the already-guarded salt, matching canonical CreateX.
    function computeCreate3Address(bytes32 _guardedSalt) external view override returns (address computedAddress) {
        return CREATE3.getDeployed(_guardedSalt, address(this));
    }

    /// @inheritdoc ICreateX
    /// @notice Solady-style general CREATE3 prediction for any salt/deployer.
    function computeCreate3Address(
        bytes32 _salt,
        address _deployer
    ) external pure override returns (address computedAddress) {
        return CREATE3.getDeployed(_salt, _deployer);
    }

    /// @dev Mirrors CreateX._guard for the permissioned, no-chain-protection case.
    ///      The caller address is encoded in the salt itself (first 20 bytes);
    ///      the guarded salt is keccak256(abi.encodePacked(bytes32(sender), salt)).
    function _guard(bytes32 _salt) internal pure returns (bytes32) {
        bytes32 senderBytes32 = bytes32(uint256(uint160(address(uint160(uint256(_salt) >> 96)))));
        return keccak256(abi.encodePacked(senderBytes32, _salt));
    }

    /// @notice Debug helper: returns the guarded salt that will be used for a given raw salt.
    function debugGuard(bytes32 _salt) external pure returns (bytes32) {
        return _guard(_salt);
    }
}
