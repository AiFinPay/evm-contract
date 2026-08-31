// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {TimelockWrapper} from "../contracts/TimelockWrapper.sol";
import {B2BSplitterV14} from "../contracts/B2BSplitterV14.sol";
import {Profiles} from "../contracts/Profiles.sol";
import {IProfiles} from "../contracts/interfaces/IProfiles.sol";

/// @title Timelock Tests - v1.4 timelock governance + instant PAUSER_ROLE pause
contract TimelockTest is Test {
    TimelockWrapper public wrapper;
    TimelockController public timelock;
    B2BSplitterV14 public splitter;
    Profiles public profiles;

    address public deployer = address(this);
    address public proposer = makeAddr("proposer");
    address public executor = makeAddr("executor");
    address public treasury = makeAddr("treasury");
    address public signer = makeAddr("signer");
    address public attacker = makeAddr("attacker");

    uint256 public constant MIN_DELAY = 48 hours;
    bytes32 public routeIdAgent;
    bytes32 public routeIdMerchant;

    function setUp() public {
        // Deploy wrapper + timelock (legacy helper for Ownable contracts)
        vm.prank(proposer);
        wrapper = new TimelockWrapper(proposer, executor, MIN_DELAY);
        timelock = TimelockController(wrapper.timelock());

        // v1.4 canonical route identifiers
        routeIdAgent = keccak256(bytes("agent-x402"));
        routeIdMerchant = keccak256(bytes("merchant-aifp1"));
        bytes32[] memory routeIds = new bytes32[](2);
        routeIds[0] = routeIdAgent;
        routeIds[1] = routeIdMerchant;
        uint16[] memory treasuryBps = new uint16[](2);
        treasuryBps[0] = 0;
        treasuryBps[1] = 100;
        uint16[] memory ipCreatorBps = new uint16[](2);
        ipCreatorBps[0] = 0;
        ipCreatorBps[1] = 0;
        address[] memory stablecoins = new address[](0);

        splitter = new B2BSplitterV14(
            B2BSplitterV14.ConstructorParams({
                initialAdmin: deployer,
                initialSigner: signer,
                initialPauser: deployer,
                treasury: treasury,
                stablecoins: stablecoins,
                routeIds: routeIds,
                treasuryBps: treasuryBps,
                ipCreatorBps: ipCreatorBps
            })
        );
        profiles = Profiles(address(splitter.profiles()));

        // Production bootstrap: timelock becomes the only ADMIN_ROLE holder.
        splitter.grantRole(splitter.ADMIN_ROLE(), address(timelock));
        splitter.renounceRole(splitter.ADMIN_ROLE(), deployer);
        // deployer intentionally keeps PAUSER_ROLE for instant kill-switch tests.
    }

    /// Verify the production bootstrap left ADMIN_ROLE with the timelock.
    function test_TimelockHoldsAdminRole() public view {
        assertTrue(splitter.hasRole(splitter.ADMIN_ROLE(), address(timelock)), "Timelock should hold ADMIN_ROLE");
        assertFalse(splitter.hasRole(splitter.ADMIN_ROLE(), deployer), "Deployer should have renounced ADMIN_ROLE");
        assertEq(timelock.getMinDelay(), MIN_DELAY, "Delay should be 48h");
    }

    /// Verify proposer can schedule a v1.4 admin operation.
    function test_ProposerCanSchedule() public {
        bytes memory data = abi.encodeCall(B2BSplitterV14.configureRoute, (routeIdAgent, 200, 50, address(0)));
        bytes32 salt = keccak256("test-salt");

        vm.prank(proposer);
        timelock.schedule(address(splitter), 0, data, bytes32(0), salt, MIN_DELAY);

        bytes32 id = timelock.hashOperation(address(splitter), 0, data, bytes32(0), salt);
        assertTrue(timelock.isOperation(id), "Operation should be scheduled");
    }

    /// Verify attacker cannot schedule operations.
    function test_AttackerCannotSchedule() public {
        bytes memory data = abi.encodeCall(B2BSplitterV14.configureRoute, (routeIdAgent, 200, 50, address(0)));

        vm.prank(attacker);
        vm.expectRevert();
        timelock.schedule(address(splitter), 0, data, bytes32(0), keccak256("salt"), MIN_DELAY);
    }

    /// Verify operation cannot execute before delay.
    function test_CannotExecuteBeforeDelay() public {
        bytes memory data = abi.encodeCall(B2BSplitterV14.configureRoute, (routeIdAgent, 200, 50, address(0)));
        bytes32 salt = keccak256("test-salt");

        vm.prank(proposer);
        timelock.schedule(address(splitter), 0, data, bytes32(0), salt, MIN_DELAY);

        bytes32 id = timelock.hashOperation(address(splitter), 0, data, bytes32(0), salt);

        vm.prank(executor);
        vm.expectRevert();
        timelock.execute(address(splitter), 0, data, bytes32(0), salt);

        assertFalse(timelock.isOperationReady(id), "Should not be ready yet");
    }

    /// Verify a route configuration can be executed after the delay.
    function test_CanExecuteAfterDelay() public {
        bytes32 newRoute = keccak256(bytes("new-route"));
        bytes memory data = abi.encodeCall(B2BSplitterV14.configureRoute, (newRoute, 200, 50, address(0)));
        bytes32 salt = keccak256("test-salt");

        vm.prank(proposer);
        timelock.schedule(address(splitter), 0, data, bytes32(0), salt, MIN_DELAY);

        vm.warp(block.timestamp + MIN_DELAY + 1);

        vm.prank(executor);
        timelock.execute(address(splitter), 0, data, bytes32(0), salt);

        IProfiles.RouteProfile memory profile = profiles.getProfile(newRoute);
        assertEq(profile.treasuryBps, 200, "Treasury BPS should be updated");
        assertEq(profile.ipCreatorBps, 50, "IP BPS should be updated");
    }

    /// Verify proposer can cancel operations.
    function test_ProposerCanCancel() public {
        bytes memory data = abi.encodeCall(B2BSplitterV14.configureRoute, (routeIdAgent, 200, 50, address(0)));
        bytes32 salt = keccak256("test-salt");

        vm.prank(proposer);
        timelock.schedule(address(splitter), 0, data, bytes32(0), salt, MIN_DELAY);

        bytes32 id = timelock.hashOperation(address(splitter), 0, data, bytes32(0), salt);

        vm.prank(proposer);
        timelock.cancel(id);

        assertFalse(timelock.isOperation(id), "Operation should be cancelled");
    }

    /// Fee caps are enforced at execution time, not at scheduling time.
    function test_FeeCapsEnforcedDuringExecution() public {
        bytes memory data = abi.encodeCall(
            B2BSplitterV14.configureRoute,
            (routeIdAgent, 600, 0, address(0)) // 600 > MAX_TREASURY_BPS (500)
        );
        bytes32 salt = keccak256("fee-salt");

        vm.prank(proposer);
        timelock.schedule(address(splitter), 0, data, bytes32(0), salt, MIN_DELAY);

        vm.warp(block.timestamp + MIN_DELAY + 1);

        vm.prank(executor);
        vm.expectRevert();
        timelock.execute(address(splitter), 0, data, bytes32(0), salt);
    }

    /// Verify treasury address change requires timelock.
    function test_TreasuryChangeRequiresTimelock() public {
        address newTreasury = makeAddr("newTreasury");
        bytes memory data = abi.encodeCall(B2BSplitterV14.setTreasury, (newTreasury));
        bytes32 salt = keccak256("treasury-salt");

        vm.prank(proposer);
        timelock.schedule(address(splitter), 0, data, bytes32(0), salt, MIN_DELAY);

        vm.warp(block.timestamp + MIN_DELAY + 1);

        vm.prank(executor);
        timelock.execute(address(splitter), 0, data, bytes32(0), salt);

        assertEq(splitter.treasury(), newTreasury, "Treasury should be updated");
    }

    /// Verify timelock-scheduled pause works after the delay.
    function test_PauseRequiresTimelock() public {
        bytes memory data = abi.encodeCall(B2BSplitterV14.pause, ());
        bytes32 salt = keccak256("pause-salt");

        vm.prank(proposer);
        timelock.schedule(address(splitter), 0, data, bytes32(0), salt, MIN_DELAY);

        vm.warp(block.timestamp + MIN_DELAY + 1);

        vm.prank(executor);
        timelock.execute(address(splitter), 0, data, bytes32(0), salt);

        assertTrue(splitter.paused(), "Should be paused");
    }

    /// PAUSER_ROLE can pause instantly, but cannot unpause (ADMIN-only).
    function test_PauserCanPauseInstantly() public {
        splitter.pause();
        assertTrue(splitter.paused(), "Pauser should pause instantly");

        vm.expectRevert();
        splitter.unpause();

        // Unpause must go through the timelock.
        bytes memory data = abi.encodeCall(B2BSplitterV14.unpause, ());
        bytes32 salt = keccak256("unpause-salt");

        vm.prank(proposer);
        timelock.schedule(address(splitter), 0, data, bytes32(0), salt, MIN_DELAY);

        vm.warp(block.timestamp + MIN_DELAY + 1);

        vm.prank(executor);
        timelock.execute(address(splitter), 0, data, bytes32(0), salt);

        assertFalse(splitter.paused(), "Should be unpaused");
    }

    /// Verify multiple operations can be scheduled.
    function test_MultipleOperationsScheduled() public {
        bytes memory data1 = abi.encodeCall(
            B2BSplitterV14.configureRoute,
            (keccak256(bytes("r1")), 200, 50, address(0))
        );
        bytes memory data2 = abi.encodeCall(B2BSplitterV14.pause, ());

        vm.prank(proposer);
        timelock.schedule(address(splitter), 0, data1, bytes32(0), keccak256("salt1"), MIN_DELAY);

        vm.prank(proposer);
        timelock.schedule(address(splitter), 0, data2, bytes32(0), keccak256("salt2"), MIN_DELAY);

        bytes32 id1 = timelock.hashOperation(address(splitter), 0, data1, bytes32(0), keccak256("salt1"));
        bytes32 id2 = timelock.hashOperation(address(splitter), 0, data2, bytes32(0), keccak256("salt2"));

        assertTrue(timelock.isOperation(id1), "First operation scheduled");
        assertTrue(timelock.isOperation(id2), "Second operation scheduled");
    }

    /// Wrapper renounces its optional TimelockController admin role on destroy.
    function test_WrapperDestroyRenouncesAdminRole() public {
        vm.deal(address(wrapper), 1 ether);
        uint256 timelockBalanceBefore = address(timelock).balance;

        vm.prank(proposer);
        wrapper.destroy();

        assertFalse(
            timelock.hasRole(timelock.DEFAULT_ADMIN_ROLE(), address(wrapper)),
            "Wrapper should no longer be timelock admin"
        );
        assertEq(
            address(timelock).balance - timelockBalanceBefore,
            1 ether,
            "Wrapper balance should be forwarded to timelock"
        );
    }

    /// Fuzz: valid route configurations can be scheduled and executed.
    function testFuzz_ScheduleAndExecute(uint16 treasuryBps, uint16 ipBps) public {
        vm.assume(treasuryBps <= 500);
        vm.assume(ipBps <= 100);
        vm.assume(uint256(treasuryBps) + uint256(ipBps) < 10_000);

        bytes32 newRoute = keccak256(abi.encode(treasuryBps, ipBps));
        bytes memory data = abi.encodeCall(
            B2BSplitterV14.configureRoute,
            (newRoute, treasuryBps, ipBps, address(0))
        );
        bytes32 salt = keccak256(abi.encode(treasuryBps, ipBps));

        vm.prank(proposer);
        timelock.schedule(address(splitter), 0, data, bytes32(0), salt, MIN_DELAY);

        vm.warp(block.timestamp + MIN_DELAY + 1);

        vm.prank(executor);
        timelock.execute(address(splitter), 0, data, bytes32(0), salt);

        IProfiles.RouteProfile memory profile = profiles.getProfile(newRoute);
        assertEq(profile.treasuryBps, treasuryBps, "Treasury BPS mismatch");
        assertEq(profile.ipCreatorBps, ipBps, "IP BPS mismatch");
    }
}
