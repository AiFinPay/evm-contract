// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "@openzeppelin/contracts/governance/TimelockController.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title TimelockWrapper — Helper for deploying TimelockController
/// @notice Deploys a TimelockController and transfers ownership of target contracts
/// @dev Use this pattern:
///      1. Deploy TimelockWrapper with proposer (multisig) and executor addresses
///      2. Deploy target contracts with TimelockWrapper as owner
///      3. Call transferToTimelock() to transfer ownership
///      4. TimelockWrapper self-destructs, leaving TimelockController as owner
contract TimelockWrapper {
    TimelockController public immutable timelock;
    address public immutable proposer;
    address public immutable executor;
    uint256 public immutable minDelay;

    event TimelockDeployed(address indexed timelock, uint256 minDelay);
    event OwnershipTransferred(address indexed contract_, address indexed timelock);

    constructor(
        address _proposer,
        address _executor,
        uint256 _minDelay
    ) {
        require(_proposer != address(0), "Zero proposer");
        require(_minDelay >= 48 hours, "Delay too short");
        
        proposer = _proposer;
        executor = _executor;
        minDelay = _minDelay;
        
        address[] memory proposers = new address[](1);
        proposers[0] = _proposer;
        
        address[] memory executors = new address[](1);
        executors[0] = _executor;
        
        timelock = new TimelockController(
            _minDelay,
            proposers,
            executors,
            address(this) // admin (self-destructs after transfer)
        );
        
        emit TimelockDeployed(address(timelock), _minDelay);
    }

    /// @notice Transfer ownership of a contract to the timelock
    function transferToTimelock(Ownable target) external onlyProposer {
        target.transferOwnership(address(timelock));
        emit OwnershipTransferred(address(target), address(timelock));
    }

    /// @notice Transfer ownership of multiple contracts atomically
    function transferMultiple(Ownable[] calldata targets) external onlyProposer {
        for (uint256 i = 0; i < targets.length; i++) {
            targets[i].transferOwnership(address(timelock));
            emit OwnershipTransferred(address(targets[i]), address(timelock));
        }
    }

    /// @notice Self-destruct and send remaining ETH to timelock
    function destroy() external onlyProposer {
        selfdestruct(payable(address(timelock)));
    }

    modifier onlyProposer() {
        require(msg.sender == proposer, "Not proposer");
        _;
    }
}
