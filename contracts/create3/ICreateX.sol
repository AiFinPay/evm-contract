// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title ICreateX
/// @notice Minimal interface for the canonical CreateX deterministic deployer.
/// @dev Full interface lives at https://github.com/pcaversaccio/createx.
interface ICreateX {
    /// @notice Deploy a contract via CREATE3 using a guarded salt.
    /// @param _salt 32-byte salt. CreateX applies salt guarding internally.
    /// @param _initCode Full creation bytecode of the contract to deploy.
    /// @return newContract Address of the deployed child contract.
    function deployCreate3(bytes32 _salt, bytes memory _initCode) external payable returns (address newContract);

    /// @notice Predict the address for a CreateX CREATE3 deployment using the
    /// guarded salt. This is the prediction function used internally by
    /// `deployCreate3` and expects the salt *after* `_guard` has been applied.
    /// @param _salt 32-byte salt (after CreateX guarding).
    /// @return computedAddress Predicted child contract address.
    function computeCreate3Address(bytes32 _salt) external view returns (address computedAddress);

    /// @notice General Solady-style CREATE3 address computation for any salt and
    /// any deployer (not the CreateX-guarded prediction). This is exposed by
    /// CreateX for convenience but is *not* used by `deployCreate3`.
    /// @param _salt 32-byte salt.
    /// @param _deployer The deployer address.
    /// @return computedAddress Predicted child contract address.
    function computeCreate3Address(bytes32 _salt, address _deployer) external pure returns (address computedAddress);
}
