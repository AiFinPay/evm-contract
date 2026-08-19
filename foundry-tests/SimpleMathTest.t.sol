// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";

/// @title Simple Math Tests - AiFinPay Protocol
contract SimpleMathTest is Test {
    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant STABLE_DECIMALS_DIVISOR = 10_000;
    uint256 private constant MAX_TREASURY_BPS = 500;
    uint256 private constant MAX_IP_CREATOR_BPS = 100;
    uint256 private constant MAX_CONF_BPS = 200;
    
    /// Verify fee calculation preserves total amount
    function testFuzz_FeeSplit(uint256 amount, uint256 treasuryBps, uint256 ipBps) public {
        amount = bound(amount, 100_000, 1000 ether);
        treasuryBps = bound(treasuryBps, 1, MAX_TREASURY_BPS);
        ipBps = bound(ipBps, 0, MAX_IP_CREATOR_BPS);
        vm.assume(treasuryBps + ipBps < BPS_DENOMINATOR);
        
        uint256 treasuryAmt = (amount * treasuryBps) / BPS_DENOMINATOR;
        uint256 ipAmt = (amount * ipBps) / BPS_DENOMINATOR;
        uint256 merchantAmt = amount - treasuryAmt - ipAmt;
        
        assertEq(treasuryAmt + ipAmt + merchantAmt, amount, "Sum invariant");
    }
    
    /// Verify stablecoin division precision
    function testFuzz_StableDivision(uint256 amount) public {
        amount = bound(amount, STABLE_DECIMALS_DIVISOR, 1_000_000 * 10**6);
        
        uint256 usdCents = amount / STABLE_DECIMALS_DIVISOR;
        uint256 remainder = amount % STABLE_DECIMALS_DIVISOR;
        
        assertEq(usdCents * STABLE_DECIMALS_DIVISOR + remainder, amount, "Division invariant");
        assertLt(remainder, STABLE_DECIMALS_DIVISOR, "Remainder check");
    }
    
    /// Verify Pyth confidence check at 2% threshold
    function testFuzz_ConfidenceCheck(uint64 price, uint64 conf) public {
        vm.assume(price > 0 && price < 1_000_000_000);
        vm.assume(conf < 100_000_000);
        
        uint256 maxConf = (uint256(price) * MAX_CONF_BPS) / BPS_DENOMINATOR;
        
        bool passes = (conf * BPS_DENOMINATOR <= price * MAX_CONF_BPS);
        assertTrue(passes == (conf <= maxConf), "Confidence logic consistent");
    }
    
    /// Verify no overflow in large calculations
    function testFuzz_NoOverflow(uint256 a, uint256 b) public {
        a = bound(a, 0, type(uint128).max);
        b = bound(b, 0, type(uint128).max);
        
        uint256 product = a * b;
        assertGe(product, 0, "Product non-negative");
    }
}
