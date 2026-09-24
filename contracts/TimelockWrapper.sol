// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { ZeroAddress, ZeroProposer, DelayTooShort, NotProposer, EthForwardFailed } from "./errors/Errors.sol";

/// @title TimelockWrapper — Helper for deploying TimelockController
/// @notice Deploys a TimelockController and transfers ownership / RBAC roles
///         of target contracts to the TIMELOCK.
/// @dev Supports both Ownable targets (legacy v1.3/v5.3) and AccessControl
///      targets (v1.4+). Use this pattern:
///      1. Deploy TimelockWrapper with proposer (multisig) and executor addresses
///      2. For Ownable contracts: deploy with TimelockWrapper as owner, then
///         call transferToTimelock() / transferMultiple()
///      3. For AccessControl contracts: grant the relevant role to the wrapper,
///         then call grantRoleToTimelock() / renounceRoleOnTarget()
///      4. Call destroy() to renounce the wrapper's optional TimelockController
///         admin role and forward any balance to the TIMELOCK.
contract TimelockWrapper {
    TimelockController public immutable TIMELOCK;
    address public immutable PROPOSER;
    address public immutable EXECUTOR;
    uint256 public immutable MIN_DELAY;

    event TimelockDeployed(address indexed TIMELOCK, uint256 indexed minDelay);
    event OwnershipTransferred(address indexed contract_, address indexed TIMELOCK);
    event AdminRenounced(address indexed TIMELOCK);

    constructor(address _proposer, address _executor, uint256 _minDelay) {
        if (_proposer == address(0)) revert ZeroProposer();
        if (_executor == address(0)) revert ZeroAddress();
        if (_minDelay < 48 hours) revert DelayTooShort();

        PROPOSER = _proposer;
        EXECUTOR = _executor;
        MIN_DELAY = _minDelay;

        address[] memory proposers = new address[](1);
        proposers[0] = _proposer;

        address[] memory executors = new address[](1);
        executors[0] = _executor;

        TIMELOCK = new TimelockController(
            _minDelay,
            proposers,
            executors,
            address(this) // optional admin (renounced via destroy())
        );

        emit TimelockDeployed(address(TIMELOCK), MIN_DELAY);
    }

    /// @notice Transfer ownership of an Ownable contract to the TIMELOCK
    ///         (legacy v1.3/v5.3 targets).
    function transferToTimelock(Ownable target) external onlyProposer {
        target.transferOwnership(address(TIMELOCK));
        emit OwnershipTransferred(address(target), address(TIMELOCK));
    }

    /// @notice Transfer ownership of multiple Ownable contracts atomically.
    function transferMultiple(Ownable[] calldata targets) external onlyProposer {
        for (uint256 i = 0; i < targets.length; ++i) {
            targets[i].transferOwnership(address(TIMELOCK));
            emit OwnershipTransferred(address(targets[i]), address(TIMELOCK));
        }
    }

    /// @notice Grant an AccessControl role on `_target` to the TIMELOCK.
    /// @dev The wrapper must already hold the role's admin role on `_target`.
    ///      Typical v1.4 bootstrap: deployer grants `ADMIN_ROLE` to the wrapper,
    ///      then the Safe proposer calls this helper to move admin to TIMELOCK.
    function grantRoleToTimelock(IAccessControl target, bytes32 role) external onlyProposer {
        target.grantRole(role, address(TIMELOCK));
    }

    /// @notice Renounce the wrapper's own AccessControl role on `_target`.
    /// @dev Call after `grantRoleToTimelock` so the wrapper no longer holds
    ///      the privileged role.
    function renounceRoleOnTarget(IAccessControl target, bytes32 role) external onlyProposer {
        target.renounceRole(role, address(this));
    }

    /// @notice Renounce the wrapper's optional TimelockController admin role
    ///         and forward any accumulated ETH balance to the TIMELOCK.
    /// @dev Post-EIP-6780 (Cancun) `selfdestruct` no longer removes code in a
    ///      subsequent transaction, so this routine sheds privileges by
    ///      renouncing the admin role instead of relying on code destruction.
    ///      The wrapper contract will persist but will no longer hold any
    ///      TimelockController admin privileges.
    function destroy() external onlyProposer {
        TIMELOCK.renounceRole(TIMELOCK.DEFAULT_ADMIN_ROLE(), address(this));
        emit AdminRenounced(address(TIMELOCK));
        (bool success, ) = payable(address(TIMELOCK)).call{ value: address(this).balance }("");
        if (!success) revert EthForwardFailed();
    }

    modifier onlyProposer() {
        _onlyProposer();
        _;
    }

    function _onlyProposer() internal view {
        if (msg.sender != PROPOSER) revert NotProposer();
    }
}
