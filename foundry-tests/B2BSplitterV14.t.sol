// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {B2BSplitterV14} from "../contracts/B2BSplitterV14.sol";
import {MockERC20} from "../contracts/mocks/MockERC20.sol";

/// @title B2BSplitterV14 Settlement + RBAC Tests
/// @notice Foundry unit tests for signed multi-route settlement, replay
///         protection, and role-based access control.
contract B2BSplitterV14Test is Test {
    B2BSplitterV14 public splitter;
    MockERC20 public usdc;

    uint256 public constant SIGNER_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address public signer;

    address public admin = makeAddr("admin");
    address public pauser = makeAddr("pauser");
    address public treasury = makeAddr("treasury");
    address public payer = makeAddr("payer");
    address public merchant = makeAddr("merchant");
    address public ipCreator = makeAddr("ipCreator");
    address public attacker = makeAddr("attacker");

    bytes32 public routeIdAgent;
    bytes32 public routeIdMerchant;

    function setUp() public {
        signer = vm.addr(SIGNER_KEY);

        usdc = new MockERC20("USDC", "USDC", 6);

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

        address[] memory stablecoins = new address[](1);
        stablecoins[0] = address(usdc);

        splitter = new B2BSplitterV14(
            B2BSplitterV14.ConstructorParams({
                initialAdmin: admin,
                initialSigner: signer,
                initialPauser: pauser,
                treasury: treasury,
                stablecoins: stablecoins,
                routeIds: routeIds,
                treasuryBps: treasuryBps,
                ipCreatorBps: ipCreatorBps
            })
        );
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    function _quote(
        address _payer,
        address _merchant,
        address _token,
        uint256 _grossAmount,
        uint256 _nonce,
        bytes32 _routeId
    ) private view returns (B2BSplitterV14.Quote memory) {
        return
            B2BSplitterV14.Quote({
                payer: _payer,
                merchant: _merchant,
                token: _token,
                grossAmount: _grossAmount,
                ipCreator: address(0),
                validUntil: block.timestamp + 1 hours,
                orderIdHash: keccak256(abi.encodePacked("order", _nonce)),
                nonce: _nonce,
                routeId: _routeId
            });
    }

    function _signQuote(B2BSplitterV14.Quote memory quote_) private view returns (bytes memory) {
        bytes32 digest = splitter.digest(quote_);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    // ── Settlement ───────────────────────────────────────────────────────────

    function test_NativeSplit_Aifp1() public {
        uint256 gross = 10_000;
        B2BSplitterV14.Quote memory quote = _quote(payer, merchant, address(0), gross, 0, routeIdMerchant);
        bytes memory sig = _signQuote(quote);

        uint256 mb = merchant.balance;
        uint256 tb = treasury.balance;

        vm.deal(payer, gross);
        vm.prank(payer);
        splitter.settleNative{value: gross}(quote, sig);

        assertEq(merchant.balance - mb, 9_900, "merchant receives 99%");
        assertEq(treasury.balance - tb, 100, "treasury receives 1%");
        assertEq(address(splitter).balance, 0, "no dust left in splitter");
    }

    function test_NativeSplit_Aifp2() public {
        uint256 gross = 1 ether;
        B2BSplitterV14.Quote memory quote = _quote(payer, merchant, address(0), gross, 0, routeIdAgent);
        bytes memory sig = _signQuote(quote);

        vm.deal(payer, gross);
        vm.prank(payer);
        splitter.settleNative{value: gross}(quote, sig);

        assertEq(merchant.balance, gross, "merchant receives full amount");
        assertEq(address(splitter).balance, 0, "no dust left in splitter");
    }

    function test_StableSplit_Aifp1() public {
        uint256 gross = 1_000_000; // 1 USDC
        B2BSplitterV14.Quote memory quote = _quote(payer, merchant, address(usdc), gross, 0, routeIdMerchant);
        bytes memory sig = _signQuote(quote);

        usdc.mint(payer, gross);
        vm.prank(payer);
        usdc.approve(address(splitter), gross);

        vm.prank(payer);
        splitter.settleStable(quote, sig);

        assertEq(usdc.balanceOf(merchant), 990_000, "merchant receives 99%");
        assertEq(usdc.balanceOf(treasury), 10_000, "treasury receives 1%");
    }

    function test_RequiresExactNativeValue() public {
        uint256 gross = 1 ether;
        B2BSplitterV14.Quote memory quote = _quote(payer, merchant, address(0), gross, 0, routeIdMerchant);
        bytes memory sig = _signQuote(quote);

        vm.deal(payer, gross);
        vm.prank(payer);
        vm.expectRevert();
        splitter.settleNative{value: gross - 1}(quote, sig);
    }

    function test_RejectsExpiredSignature() public {
        B2BSplitterV14.Quote memory quote = _quote(payer, merchant, address(0), 1 ether, 0, routeIdMerchant);
        quote.validUntil = block.timestamp - 1;
        bytes memory sig = _signQuote(quote);

        vm.deal(payer, 1 ether);
        vm.prank(payer);
        vm.expectRevert();
        splitter.settleNative{value: 1 ether}(quote, sig);
    }

    function test_RejectsInvalidSigner() public {
        B2BSplitterV14.Quote memory quote = _quote(payer, merchant, address(0), 1 ether, 0, routeIdMerchant);
        bytes32 digest = splitter.digest(quote);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.deal(payer, 1 ether);
        vm.prank(payer);
        vm.expectRevert();
        splitter.settleNative{value: 1 ether}(quote, sig);
    }

    function test_RejectsNonPayer() public {
        B2BSplitterV14.Quote memory quote = _quote(payer, merchant, address(0), 1 ether, 0, routeIdMerchant);
        bytes memory sig = _signQuote(quote);

        vm.deal(attacker, 1 ether);
        vm.prank(attacker);
        vm.expectRevert();
        splitter.settleNative{value: 1 ether}(quote, sig);
    }

    function test_RejectsReplayedNonce() public {
        uint256 gross = 1 ether;
        B2BSplitterV14.Quote memory quote = _quote(payer, merchant, address(0), gross, 0, routeIdMerchant);
        bytes memory sig = _signQuote(quote);

        vm.deal(payer, 2 * gross);
        vm.prank(payer);
        splitter.settleNative{value: gross}(quote, sig);

        vm.prank(payer);
        vm.expectRevert();
        splitter.settleNative{value: gross}(quote, sig);
    }

    function test_RejectsUnknownRoute() public {
        bytes32 unknownRoute = keccak256(bytes("unknown"));
        B2BSplitterV14.Quote memory quote = _quote(payer, merchant, address(0), 1 ether, 0, unknownRoute);
        bytes memory sig = _signQuote(quote);

        vm.deal(payer, 1 ether);
        vm.prank(payer);
        vm.expectRevert();
        splitter.settleNative{value: 1 ether}(quote, sig);
    }

    function test_RejectsDisabledRoute() public {
        vm.prank(admin);
        splitter.disableRoute(routeIdMerchant);

        B2BSplitterV14.Quote memory quote = _quote(payer, merchant, address(0), 1 ether, 0, routeIdMerchant);
        bytes memory sig = _signQuote(quote);

        vm.deal(payer, 1 ether);
        vm.prank(payer);
        vm.expectRevert();
        splitter.settleNative{value: 1 ether}(quote, sig);
    }

    function test_QuoteTotal_MatchesSettlement() public view {
        (uint256 merchantAmt, uint256 treasuryAmt, uint256 ipAmt, uint256 total) = splitter.quoteTotal(
            10_000,
            routeIdMerchant,
            address(0)
        );
        assertEq(merchantAmt, 9_900);
        assertEq(treasuryAmt, 100);
        assertEq(ipAmt, 0);
        assertEq(total, 10_000);
    }

    function test_QuoteTotal_RevertsForDisabledRoute() public {
        vm.prank(admin);
        splitter.disableRoute(routeIdMerchant);

        vm.expectRevert();
        splitter.quoteTotal(10_000, routeIdMerchant, address(0));
    }

    // ── RBAC ───────────────────────────────────────────────────────────────────

    function test_PauserCanPauseInstantly() public {
        vm.prank(pauser);
        splitter.pause();
        assertTrue(splitter.paused());
    }

    function test_PauserCannotUnpause() public {
        vm.prank(pauser);
        splitter.pause();

        vm.prank(pauser);
        vm.expectRevert();
        splitter.unpause();
    }

    function test_SignerCannotPause() public {
        vm.prank(signer);
        vm.expectRevert();
        splitter.pause();
    }

    function test_SignerCannotConfigureRoute() public {
        vm.prank(signer);
        vm.expectRevert();
        splitter.configureRoute(routeIdAgent, 0, 0, address(0));
    }

    function test_RoleSeparation_PreventsConflictingGrants() public {
        address newSigner = makeAddr("newSigner");
        address newPauser = makeAddr("newPauser");

        // Cannot grant SIGN to a pauser.
        vm.prank(admin);
        splitter.grantPauserRole(newPauser);
        vm.prank(admin);
        vm.expectRevert();
        splitter.grantSignerRole(newPauser);

        // Cannot grant PAUSER to a signer.
        vm.prank(admin);
        splitter.grantSignerRole(newSigner);
        vm.prank(admin);
        vm.expectRevert();
        splitter.grantPauserRole(newSigner);
    }

    // ── Fuzz ───────────────────────────────────────────────────────────────────

    /// @dev Settlement amounts are split exactly and leave no value in the splitter.
    function testFuzz_NativeSplitConservesValue(uint96 grossAmount) public {
        vm.assume(grossAmount > 10_000);

        B2BSplitterV14.Quote memory quote = _quote(payer, merchant, address(0), grossAmount, 0, routeIdMerchant);
        bytes memory sig = _signQuote(quote);

        uint256 mb = merchant.balance;
        uint256 tb = treasury.balance;

        vm.deal(payer, grossAmount);
        vm.prank(payer);
        splitter.settleNative{value: grossAmount}(quote, sig);

        assertEq(merchant.balance - tb + treasury.balance - mb, grossAmount, "sum of outputs equals gross");
        assertEq(address(splitter).balance, 0, "no dust left");
    }
}
