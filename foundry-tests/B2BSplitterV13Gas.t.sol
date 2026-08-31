// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { Test, Vm } from "forge-std/Test.sol";
import { B2BSplitterV13 } from "../contracts/B2BSplitterV13.sol";
import { MockERC20 } from "../contracts/mocks/MockERC20.sol";

/// @notice Gas benchmark for B2BSplitterV13 payment paths.
/// @dev Run with `forge test --match-contract B2BSplitterV13Gas --gas-report`.
contract B2BSplitterV13Gas is Test {
    uint256 private constant BPS = 10_000;

    B2BSplitterV13 private splitter;
    MockERC20 private usdc;

    address private owner = makeAddr("owner");
    address private treasury = makeAddr("treasury");
    address private agent = makeAddr("agent");
    address private merchant = makeAddr("merchant");
    address private creator = makeAddr("creator");

    bytes32 private constant PAYMENT_ID = keccak256("gas-bench");

    function setUp() public {
        usdc = new MockERC20("USDC", "USDC", 6);
        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);
        splitter = new B2BSplitterV13(B2BSplitterV13.ConstructorParams(owner, treasury, tokens, 100, 0));
        usdc.mint(agent, 1_000_000 * 10 ** 6);
        vm.prank(agent);
        usdc.approve(address(splitter), type(uint256).max);
    }

    function _nextId() private returns (bytes32) {
        return keccak256(abi.encodePacked(PAYMENT_ID, vm.getNonce(agent)));
    }

    function testGas_PayNative_Aifp1() public {
        vm.deal(agent, 1 ether);
        vm.prank(agent);
        splitter.payNative{ value: 1 ether }(
            B2BSplitterV13.NativePayment({
                paymentId: _nextId(),
                merchant: payable(merchant),
                grossAmount: 1 ether,
                ipCreator: address(0),
                validUntil: block.timestamp + 1 hours,
                orderId: "native-aifp1"
            })
        );
    }

    function testGas_PayNative_Aifp2() public {
        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);
        B2BSplitterV13 zeroSplitter =
            new B2BSplitterV13(B2BSplitterV13.ConstructorParams(owner, treasury, tokens, 0, 0));
        vm.deal(agent, 1 ether);
        vm.prank(agent);
        zeroSplitter.payNative{ value: 1 ether }(
            B2BSplitterV13.NativePayment({
                paymentId: _nextId(),
                merchant: payable(merchant),
                grossAmount: 1 ether,
                ipCreator: address(0),
                validUntil: block.timestamp + 1 hours,
                orderId: "native-aifp2"
            })
        );
    }

    function testGas_PayStable_Aifp1() public {
        vm.prank(agent);
        splitter.payStable(
            B2BSplitterV13.StablePayment({
                paymentId: _nextId(),
                token: address(usdc),
                grossAmount: 500_000_000,
                merchant: merchant,
                ipCreator: address(0),
                validUntil: block.timestamp + 1 hours,
                orderId: "stable-aifp1"
            })
        );
    }

    function testGas_PayStable_Aifp2() public {
        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);
        B2BSplitterV13 zeroSplitter =
            new B2BSplitterV13(B2BSplitterV13.ConstructorParams(owner, treasury, tokens, 0, 0));
        vm.prank(agent);
        usdc.approve(address(zeroSplitter), type(uint256).max);
        vm.prank(agent);
        zeroSplitter.payStable(
            B2BSplitterV13.StablePayment({
                paymentId: _nextId(),
                token: address(usdc),
                grossAmount: 500_000_000,
                merchant: merchant,
                ipCreator: address(0),
                validUntil: block.timestamp + 1 hours,
                orderId: "stable-aifp2"
            })
        );
    }

    function testGas_QuoteTotal_Aifp1() public view {
        splitter.quoteTotal(1 ether, address(0));
    }

    function testGas_QuoteTotal_Aifp2() public view {
        splitter.quoteTotal(1 ether, creator);
    }
}
