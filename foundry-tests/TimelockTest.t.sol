// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {TimelockWrapper} from "../contracts/TimelockWrapper.sol";
import {B2BSplitter} from "../contracts/B2BSplitter.sol";

/// @title Timelock Tests - Comprehensive timelock functionality testing
contract TimelockTest is Test {
    TimelockWrapper public wrapper;
    TimelockController public timelock;
    B2BSplitter public splitter;
    
    address public proposer = makeAddr("proposer");
    address public executor = makeAddr("executor");
    address public treasury = makeAddr("treasury");
    address public attacker = makeAddr("attacker");
    
    uint256 public constant MIN_DELAY = 48 hours;
    
    function setUp() public {
        // Deploy wrapper with timelock
        vm.prank(proposer);
        wrapper = new TimelockWrapper(proposer, executor, MIN_DELAY);
        
        timelock = TimelockController(wrapper.timelock());
        
        // Deploy splitter with wrapper as owner (will transfer to timelock)
        splitter = new B2BSplitter(
            address(wrapper),
            treasury,
            address(0),
            address(0)
        );
        
        // Transfer ownership to timelock
        vm.prank(proposer);
        wrapper.transferToTimelock(splitter);
    }
    
    /// Verify timelock is owner after transfer
    function test_TimelockBecomesOwner() public {
        assertEq(splitter.owner(), address(timelock), "Timelock should be owner");
        assertEq(timelock.getMinDelay(), MIN_DELAY, "Delay should be 48h");
    }
    
    /// Verify proposer can schedule operations
    function test_ProposerCanSchedule() public {
        bytes memory data = abi.encodeCall(B2BSplitter.setSplit, (200, 50));
        bytes32 predecessor = bytes32(0);
        bytes32 salt = keccak256("test-salt");
        uint256 delay = MIN_DELAY;
        
        vm.prank(proposer);
        timelock.schedule(
            address(splitter),
            0,
            data,
            predecessor,
            salt,
            delay
        );
        
        bytes32 id = timelock.hashOperation(address(splitter), 0, data, predecessor, salt);
        assertTrue(timelock.isOperation(id), "Operation should be scheduled");
    }
    
    /// Verify attacker cannot schedule operations
    function test_AttackerCannotSchedule() public {
        bytes memory data = abi.encodeCall(B2BSplitter.setSplit, (200, 50));
        
        vm.prank(attacker);
        vm.expectRevert();
        timelock.schedule(
            address(splitter),
            0,
            data,
            bytes32(0),
            keccak256("salt"),
            MIN_DELAY
        );
    }
    
    /// Verify operation cannot execute before delay
    function test_CannotExecuteBeforeDelay() public {
        bytes memory data = abi.encodeCall(B2BSplitter.setSplit, (200, 50));
        bytes32 salt = keccak256("test-salt");
        
        vm.prank(proposer);
        timelock.schedule(
            address(splitter),
            0,
            data,
            bytes32(0),
            salt,
            MIN_DELAY
        );
        
        bytes32 id = timelock.hashOperation(address(splitter), 0, data, bytes32(0), salt);
        
        // Try to execute immediately (should fail)
        vm.prank(executor);
        vm.expectRevert();
        timelock.execute(address(splitter), 0, data, bytes32(0), salt);
        
        assertFalse(timelock.isOperationReady(id), "Should not be ready yet");
    }
    
    /// Verify operation can execute after delay
    function test_CanExecuteAfterDelay() public {
        bytes memory data = abi.encodeCall(B2BSplitter.setSplit, (200, 50));
        bytes32 salt = keccak256("test-salt");
        
        vm.prank(proposer);
        timelock.schedule(
            address(splitter),
            0,
            data,
            bytes32(0),
            salt,
            MIN_DELAY
        );
        
        // Fast forward 48 hours + 1 second
        vm.warp(block.timestamp + MIN_DELAY + 1);
        
        bytes32 id = timelock.hashOperation(address(splitter), 0, data, bytes32(0), salt);
        assertTrue(timelock.isOperationReady(id), "Should be ready after delay");
        
        // Execute
        vm.prank(executor);
        timelock.execute(address(splitter), 0, data, bytes32(0), salt);
        
        // Verify split was updated
        (uint256 treasuryBps, uint256 ipBps) = (splitter.treasuryBps(), splitter.ipCreatorBps());
        assertEq(treasuryBps, 200, "Treasury BPS should be updated");
        assertEq(ipBps, 50, "IP BPS should be updated");
    }
    
    /// Verify proposer can cancel operations
    function test_ProposerCanCancel() public {
        bytes memory data = abi.encodeCall(B2BSplitter.setSplit, (200, 50));
        bytes32 salt = keccak256("test-salt");
        
        vm.prank(proposer);
        timelock.schedule(
            address(splitter),
            0,
            data,
            bytes32(0),
            salt,
            MIN_DELAY
        );
        
        bytes32 id = timelock.hashOperation(address(splitter), 0, data, bytes32(0), salt);
        
        // Cancel
        vm.prank(proposer);
        timelock.cancel(id);
        
        assertFalse(timelock.isOperation(id), "Operation should be cancelled");
    }
    
    /// Verify fee caps still enforced during scheduling (transaction reverts)
    function test_FeeCapsEnforcedDuringScheduling() public {
        // Try to schedule invalid fee (above cap) - this will succeed in scheduling
        // but the execution will revert when it happens
        bytes memory data = abi.encodeCall(B2BSplitter.setSplit, (600, 50)); // 600 > MAX_TREASURY_BPS (500)
        
        // Scheduling succeeds (timelock doesn't validate the call data)
        vm.prank(proposer);
        timelock.schedule(
            address(splitter),
            0,
            data,
            bytes32(0),
            keccak256("salt"),
            MIN_DELAY
        );
        
        // Fast forward
        vm.warp(block.timestamp + MIN_DELAY + 1);
        
        // Execution should revert due to fee cap check in B2BSplitter
        vm.prank(executor);
        vm.expectRevert();
        timelock.execute(address(splitter), 0, data, bytes32(0), keccak256("salt"));
    }
    
    /// Verify treasury address change requires timelock
    function test_TreasuryChangeRequiresTimelock() public {
        address newTreasury = makeAddr("newTreasury");
        bytes memory data = abi.encodeCall(B2BSplitter.setTreasury, (newTreasury));
        bytes32 salt = keccak256("treasury-salt");
        
        vm.prank(proposer);
        timelock.schedule(
            address(splitter),
            0,
            data,
            bytes32(0),
            salt,
            MIN_DELAY
        );
        
        // Fast forward
        vm.warp(block.timestamp + MIN_DELAY + 1);
        
        // Execute
        vm.prank(executor);
        timelock.execute(address(splitter), 0, data, bytes32(0), salt);
        
        assertEq(splitter.treasury(), newTreasury, "Treasury should be updated");
    }
    
    /// Verify pause/unpause requires timelock
    function test_PauseRequiresTimelock() public {
        bytes memory data = abi.encodeCall(B2BSplitter.pause, ());
        bytes32 salt = keccak256("pause-salt");
        
        vm.prank(proposer);
        timelock.schedule(
            address(splitter),
            0,
            data,
            bytes32(0),
            salt,
            MIN_DELAY
        );
        
        // Fast forward
        vm.warp(block.timestamp + MIN_DELAY + 1);
        
        // Execute
        vm.prank(executor);
        timelock.execute(address(splitter), 0, data, bytes32(0), salt);
        
        assertTrue(splitter.paused(), "Should be paused");
    }
    
    /// Verify multiple operations can be scheduled
    function test_MultipleOperationsScheduled() public {
        bytes memory data1 = abi.encodeCall(B2BSplitter.setSplit, (200, 50));
        bytes memory data2 = abi.encodeCall(B2BSplitter.pause, ());
        
        vm.prank(proposer);
        timelock.schedule(
            address(splitter),
            0,
            data1,
            bytes32(0),
            keccak256("salt1"),
            MIN_DELAY
        );
        
        vm.prank(proposer);
        timelock.schedule(
            address(splitter),
            0,
            data2,
            bytes32(0),
            keccak256("salt2"),
            MIN_DELAY
        );
        
        bytes32 id1 = timelock.hashOperation(address(splitter), 0, data1, bytes32(0), keccak256("salt1"));
        bytes32 id2 = timelock.hashOperation(address(splitter), 0, data2, bytes32(0), keccak256("salt2"));
        
        assertTrue(timelock.isOperation(id1), "First operation scheduled");
        assertTrue(timelock.isOperation(id2), "Second operation scheduled");
    }
    
    /// Verify wrapper can transfer multiple contracts
    
    /// Fuzz test: Verify any valid fee can be scheduled and executed
    function testFuzz_ScheduleAndExecute(uint256 treasuryBps, uint256 ipBps) public {
        treasuryBps = bound(treasuryBps, 1, 500);
        ipBps = bound(ipBps, 0, 100);
        vm.assume(treasuryBps + ipBps < 10_000);
        
        bytes memory data = abi.encodeCall(B2BSplitter.setSplit, (treasuryBps, ipBps));
        bytes32 salt = keccak256(abi.encode(treasuryBps, ipBps));
        
        vm.prank(proposer);
        timelock.schedule(
            address(splitter),
            0,
            data,
            bytes32(0),
            salt,
            MIN_DELAY
        );
        
        vm.warp(block.timestamp + MIN_DELAY + 1);
        
        vm.prank(executor);
        timelock.execute(address(splitter), 0, data, bytes32(0), salt);
        
        assertEq(splitter.treasuryBps(), treasuryBps, "Treasury BPS mismatch");
        assertEq(splitter.ipCreatorBps(), ipBps, "IP BPS mismatch");
    }
}
