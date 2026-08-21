// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

/// @notice Test-only stand-in for a Safe acting as the passport attestor.
/// @dev A real Safe validates a threshold of owner signatures; this validates
///      one, which is enough to prove the ERC-1271 path is wired. The point
///      under test is that AgentPassportV3 accepts a contract wallet at all,
///      not how that wallet reaches its decision.
contract MockERC1271Wallet is IERC1271 {
    bytes4 private constant MAGIC_VALUE = 0x1626ba7e;

    address public immutable SIGNER;

    constructor(address _signer) {
        SIGNER = _signer;
    }

    function isValidSignature(bytes32 _hash, bytes calldata _signature) external view returns (bytes4) {
        (address recovered, ECDSA.RecoverError err, ) = ECDSA.tryRecover(_hash, _signature);
        if (err == ECDSA.RecoverError.NoError && recovered == SIGNER) {
            return MAGIC_VALUE;
        }
        return 0xffffffff;
    }
}
