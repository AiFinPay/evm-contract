// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { ZeroAddress, ZeroProposer, DelayTooShort, NotProposer, EthForwardFailed } from "./errors/Errors.sol";

/// @title TimelockWrapper — Helper for deploying TimelockController
/// @notice Deploys a TimelockController and transfers ownership / RBAC roles
///         of target contracts to the timelock.
/// @dev Supports both Ownable targets (legacy v1.3/v5.3) and AccessControl
///      targets (v1.4+). Use this pattern:
///      1. Deploy TimelockWrapper with proposer (multisig) and executor addresses
///      2. For Ownable contracts: deploy with TimelockWrapper as owner, then
///         call transferToTimelock() / transferMultiple()
///      3. For AccessControl contracts: grant the relevant role to the wrapper,
///         then call grantRoleToTimelock() / renounceRoleOnTarget()
///      4. Call destroy() to renounce the wrapper's optional TimelockController
///         admin role and forward any balance to the timelock.
contract TimelockWrapper {
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    TimelockController public immutable timelock;
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    address public immutable proposer;
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    address public immutable executor;
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    uint256 public immutable minDelay;

    event TimelockDeployed(address indexed timelock, uint256 minDelay);
    event OwnershipTransferred(address indexed contract_, address indexed timelock);
    event AdminRenounced(address indexed timelock);

    constructor(address _proposer, address _executor, uint256 _minDelay) {
        if (_proposer == address(0)) revert ZeroProposer();
        if (_executor == address(0)) revert ZeroAddress();
        if (_minDelay < 48 hours) revert DelayTooShort();

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
            address(this) // optional admin (renounced via destroy())
        );

        emit TimelockDeployed(address(timelock), _minDelay);
    }

    /// @notice Transfer ownership of an Ownable contract to the timelock
    ///         (legacy v1.3/v5.3 targets).
    function transferToTimelock(Ownable target) external onlyProposer {
        target.transferOwnership(address(timelock));
        emit OwnershipTransferred(address(target), address(timelock));
    }

    /// @notice Transfer ownership of multiple Ownable contracts atomically.
    function transferMultiple(Ownable[] calldata targets) external onlyProposer {
        for (uint256 i = 0; i < targets.length; i++) {
            targets[i].transferOwnership(address(timelock));
            emit OwnershipTransferred(address(targets[i]), address(timelock));
        }
    }

    /// @notice Grant an AccessControl role on `_target` to the timelock.
    /// @dev The wrapper must already hold the role's admin role on `_target`.
    ///      Typical v1.4 bootstrap: deployer grants `ADMIN_ROLE` to the wrapper,
    ///      then the Safe proposer calls this helper to move admin to timelock.
    function grantRoleToTimelock(IAccessControl target, bytes32 role) external onlyProposer {
        target.grantRole(role, address(timelock));
    }

    /// @notice Renounce the wrapper's own AccessControl role on `_target`.
    /// @dev Call after `grantRoleToTimelock` so the wrapper no longer holds
    ///      the privileged role.
    function renounceRoleOnTarget(IAccessControl target, bytes32 role) external onlyProposer {
        target.renounceRole(role, address(this));
    }

    /// @notice Renounce the wrapper's optional TimelockController admin role
    ///         and forward any accumulated ETH balance to the timelock.
    /// @dev Post-EIP-6780 (Cancun) `selfdestruct` no longer removes code in a
    ///      subsequent transaction, so this routine sheds privileges by
    ///      renouncing the admin role instead of relying on code destruction.
    ///      The wrapper contract will persist but will no longer hold any
    ///      TimelockController admin privileges.
    function destroy() external onlyProposer {
        timelock.renounceRole(timelock.DEFAULT_ADMIN_ROLE(), address(this));
        emit AdminRenounced(address(timelock));
        (bool success, ) = payable(address(timelock)).call{ value: address(this).balance }("");
        if (!success) revert EthForwardFailed();
    }

    modifier onlyProposer() {
        _onlyProposer();
        _;
    }

    function _onlyProposer() internal view {
        if (msg.sender != proposer) revert NotProposer();
    }
}
