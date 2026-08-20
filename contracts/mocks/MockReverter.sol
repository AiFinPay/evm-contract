// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice Test-only contract that always reverts on plain ETH transfers.
/// @dev Used to exercise the partial-failure path of B2BSplitterV13.payNative:
///      merchant succeeds → treasury fails, and merchant fails → treasury skipped.
contract MockReverter {
    receive() external payable {
        revert("MockReverter: no thanks");
    }

    fallback() external payable {
        revert("MockReverter: no thanks");
    }
}
