// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.35;

/// @notice Sourced and adapted from Solmate (https://github.com/transmissions11/solmate).
/// @notice Deploy to deterministic addresses without an initcode factor.
library CREATE3 {
    error DeploymentFailed();
    error InitializationFailed();

    bytes internal constant PROXY_BYTECODE = hex"67_36_3d_3d_37_36_3d_34_f0_3d_52_60_08_60_18_f3";

    bytes32 internal constant PROXY_BYTECODE_HASH = keccak256(PROXY_BYTECODE);

    function deploy(bytes32 salt, bytes memory creationCode, uint256 value) internal returns (address deployed) {
        bytes memory proxyChildBytecode = PROXY_BYTECODE;

        address proxy;
        assembly ("memory-safe") {
            proxy := create2(0, add(proxyChildBytecode, 32), mload(proxyChildBytecode), salt)
        }
        if (proxy == address(0)) revert DeploymentFailed();

        deployed = getDeployed(salt);
        (bool success, ) = proxy.call{ value: value }(creationCode);
        if (!(success && deployed.code.length != 0)) revert InitializationFailed();
    }

    function getDeployed(bytes32 salt) internal view returns (address) {
        return getDeployed(salt, address(this));
    }

    function getDeployed(bytes32 salt, address creator) internal pure returns (address) {
        address proxy = address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xFF), creator, salt, PROXY_BYTECODE_HASH))))
        );
        return address(uint160(uint256(keccak256(abi.encodePacked(hex"d6_94", proxy, hex"01")))));
    }
}
