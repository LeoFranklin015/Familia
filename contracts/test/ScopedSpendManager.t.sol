// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ScopedSpendManager, IPool} from "../src/ScopedSpendManager.sol";
import {MockERC20, MockPool} from "./Mocks.sol";

contract ScopedSpendManagerTest is Test {
    ScopedSpendManager mgr;
    ScopedSpendManager mgrNoPool; // pool = address(0): direct path only
    MockERC20 eurs; // underlying (no-bool transferFrom, USDT-style)
    MockERC20 aEurs; // yield receipt
    MockPool pool;

    address funder = makeAddr("funder");
    address spender = makeAddr("spender");
    address merchant = makeAddr("merchant");
    address other = makeAddr("other");

    uint256 constant PER_TX = 50_00; // 50.00
    uint256 constant PER_PERIOD = 120_00; // 120.00
    uint256 constant WEEK = 7 days;

    function setUp() public {
        eurs = new MockERC20("EURS", 2, false); // exercises the no-return-bool path
        aEurs = new MockERC20("aEURS", 2, true);
        pool = new MockPool(aEurs, eurs);
        mgr = new ScopedSpendManager(IPool(address(pool)));
        mgrNoPool = new ScopedSpendManager(IPool(address(0)));

        // funder holds 500 aEURS; the pool holds underlying reserves to redeem against
        aEurs.mint(funder, 500_00);
        eurs.mint(address(pool), 1_000_00);

        vm.prank(funder);
        aEurs.approve(address(mgr), type(uint128).max);
    }

    function _grant() internal returns (bytes32 id) {
        vm.prank(funder);
        id = mgr.grant(spender, address(eurs), address(aEurs), PER_TX, PER_PERIOD, WEEK, 0);
    }

    function _grantDirect() internal returns (bytes32 id) {
        eurs.mint(funder, 500_00);
        vm.startPrank(funder);
        eurs.approve(address(mgr), type(uint128).max);
        id = mgr.grant(spender, address(eurs), address(eurs), PER_TX, PER_PERIOD, WEEK, 0);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ happy paths
    function test_spend_aavePath_paysMerchantAndBurnsFunderATokens() public {
        bytes32 id = _grant();
        vm.prank(spender);
        mgr.spend(id, merchant, 8_00);

        assertEq(eurs.balanceOf(merchant), 8_00, "merchant paid in underlying");
        assertEq(aEurs.balanceOf(funder), 500_00 - 8_00, "funder aTokens reduced");
        assertEq(aEurs.balanceOf(address(mgr)), 0, "manager custodies nothing across calls");
    }

    function test_spend_directPath_sameToken() public {
        bytes32 id = _grantDirect();
        vm.prank(spender);
        mgr.spend(id, merchant, 8_00);
        assertEq(eurs.balanceOf(merchant), 8_00);
    }

    function test_periodRollover_resetsSpent() public {
        bytes32 id = _grant();
        vm.startPrank(spender);
        mgr.spend(id, merchant, 50_00);
        mgr.spend(id, merchant, 50_00);
        mgr.spend(id, merchant, 20_00); // period cap 120 reached
        vm.expectRevert(abi.encodeWithSelector(ScopedSpendManager.OverPeriodCap.selector, 120_00 + 1_00, PER_PERIOD));
        mgr.spend(id, merchant, 1_00);

        vm.warp(block.timestamp + WEEK); // next window
        mgr.spend(id, merchant, 50_00); // works again
        vm.stopPrank();
        assertEq(eurs.balanceOf(merchant), 170_00);
    }

    function test_periodResetsAt_alignsToGrantTime() public {
        uint256 t0 = block.timestamp;
        bytes32 id = _grant();
        assertEq(mgr.periodResetsAt(id), t0 + WEEK);
        vm.warp(t0 + WEEK + 3 days);
        assertEq(mgr.periodResetsAt(id), t0 + 2 * WEEK);
    }

    // -------------------------------------------------------- revert paths
    function test_revert_UnknownId() public {
        vm.prank(spender);
        vm.expectRevert(ScopedSpendManager.UnknownId.selector);
        mgr.spend(bytes32(uint256(1)), merchant, 1);
    }

    function test_revert_NotSpender() public {
        bytes32 id = _grant();
        vm.prank(other);
        vm.expectRevert(ScopedSpendManager.NotSpender.selector);
        mgr.spend(id, merchant, 1_00);
    }

    function test_revert_NotFunder_onRevokeAndUpdateAndApprove() public {
        bytes32 id = _grant();
        vm.prank(spender);
        bytes32 reqId = mgr.requestSpend(id, merchant, 200_00, 1 hours);

        vm.startPrank(other);
        vm.expectRevert(ScopedSpendManager.NotFunder.selector);
        mgr.revoke(id);
        vm.expectRevert(ScopedSpendManager.NotFunder.selector);
        mgr.updateScope(id, 1, 1, 1 days, 0);
        vm.expectRevert(ScopedSpendManager.NotFunder.selector);
        mgr.approveRequest(reqId);
        vm.expectRevert(ScopedSpendManager.NotFunder.selector);
        mgr.denyRequest(reqId);
        vm.stopPrank();
    }

    function test_revert_Revoked_andSpendableZero() public {
        bytes32 id = _grant();
        vm.prank(funder);
        mgr.revoke(id);

        assertEq(mgr.spendable(id), 0);
        vm.prank(spender);
        vm.expectRevert(ScopedSpendManager.Revoked.selector);
        mgr.spend(id, merchant, 1_00);
    }

    function test_revert_Expired() public {
        vm.prank(funder);
        bytes32 id = mgr.grant(spender, address(eurs), address(aEurs), PER_TX, PER_PERIOD, WEEK, block.timestamp + 1 days);
        vm.warp(block.timestamp + 1 days + 1);

        assertEq(mgr.spendable(id), 0);
        vm.prank(spender);
        vm.expectRevert(ScopedSpendManager.Expired.selector);
        mgr.spend(id, merchant, 1_00);
    }

    function test_revert_OverPerTxCap() public {
        bytes32 id = _grant();
        vm.prank(spender);
        vm.expectRevert(abi.encodeWithSelector(ScopedSpendManager.OverPerTxCap.selector, PER_TX + 1, PER_TX));
        mgr.spend(id, merchant, PER_TX + 1);
    }

    function test_revert_RecipientNotAllowed() public {
        bytes32 id = _grant();
        address[] memory targets = new address[](1);
        targets[0] = merchant;
        vm.prank(funder);
        mgr.setAllowlist(id, targets, true);

        vm.startPrank(spender);
        mgr.spend(id, merchant, 1_00); // allowlisted recipient works
        vm.expectRevert(abi.encodeWithSelector(ScopedSpendManager.RecipientNotAllowed.selector, other));
        mgr.spend(id, other, 1_00);
        vm.stopPrank();

        // removing the last entry empties the allowlist => any recipient again
        vm.prank(funder);
        mgr.setAllowlist(id, targets, false);
        vm.prank(spender);
        mgr.spend(id, other, 1_00);
    }

    function test_revert_PoolNotSet_onYieldScopeWithoutPool() public {
        vm.prank(funder);
        vm.expectRevert(ScopedSpendManager.PoolNotSet.selector);
        mgrNoPool.grant(spender, address(eurs), address(aEurs), PER_TX, PER_PERIOD, WEEK, 0);
    }

    function test_revert_TransferFailed_whenAllowanceMissing() public {
        vm.prank(funder);
        aEurs.approve(address(mgr), 0);
        bytes32 id = _grant();
        vm.prank(spender);
        vm.expectRevert(ScopedSpendManager.TransferFailed.selector);
        mgr.spend(id, merchant, 1_00);
    }

    // ------------------------------------------------------------- requests
    function test_requestFlow_approveBypassesCapsButNotRevocation() public {
        bytes32 id = _grant();
        uint256 big = 200_00; // over both caps

        vm.prank(spender);
        bytes32 reqId = mgr.requestSpend(id, merchant, big, 1 hours);

        vm.prank(funder);
        mgr.approveRequest(reqId); // explicit authorisation outranks the caps
        assertEq(eurs.balanceOf(merchant), big);

        // a second settle of the same request must fail
        vm.prank(funder);
        vm.expectRevert(ScopedSpendManager.RequestNotPending.selector);
        mgr.approveRequest(reqId);

        // ...but revocation still kills pending requests
        vm.prank(spender);
        bytes32 reqId2 = mgr.requestSpend(id, merchant, big, 1 hours);
        vm.prank(funder);
        mgr.revoke(id);
        vm.prank(funder);
        vm.expectRevert(ScopedSpendManager.Revoked.selector);
        mgr.approveRequest(reqId2);
    }

    function test_revert_RequestExpired() public {
        bytes32 id = _grant();
        vm.prank(spender);
        bytes32 reqId = mgr.requestSpend(id, merchant, 200_00, 1 hours);
        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(funder);
        vm.expectRevert(ScopedSpendManager.RequestExpired.selector);
        mgr.approveRequest(reqId);
    }

    function test_denyRequest() public {
        bytes32 id = _grant();
        vm.prank(spender);
        bytes32 reqId = mgr.requestSpend(id, merchant, 200_00, 1 hours);
        vm.prank(funder);
        mgr.denyRequest(reqId);
        vm.prank(funder);
        vm.expectRevert(ScopedSpendManager.RequestNotPending.selector);
        mgr.approveRequest(reqId);
    }

    // ------------------------------------------------------------- spendable
    function test_spendable_netsCapsBalanceAndAllowance() public {
        bytes32 id = _grant();
        // fresh scope: min(perTx=50, period=120, balance=500, allowance=max)
        assertEq(mgr.spendable(id), PER_TX);

        vm.prank(spender);
        mgr.spend(id, merchant, 45_00);
        vm.prank(spender);
        mgr.spend(id, merchant, 50_00);
        // period remaining = 120 - 95 = 25 < perTx
        assertEq(mgr.spendable(id), 25_00);

        // allowance becomes the binding constraint
        vm.prank(funder);
        aEurs.approve(address(mgr), 10_00);
        assertEq(mgr.spendable(id), 10_00);

        // balance becomes the binding constraint
        vm.prank(funder);
        aEurs.approve(address(mgr), type(uint128).max);
        aEurs.burnFor(funder, aEurs.balanceOf(funder) - 3_00);
        assertEq(mgr.spendable(id), 3_00);
    }

    function test_spendable_truthful_neverReverts() public {
        bytes32 id = _grant();
        uint256 ok = mgr.spendable(id);
        vm.prank(spender);
        mgr.spend(id, merchant, ok); // exactly spendable() must clear
    }

    // ------------------------------------------------------------ updateScope
    function test_updateScope_changesCaps() public {
        bytes32 id = _grant();
        vm.prank(funder);
        mgr.updateScope(id, 10_00, 20_00, WEEK, 0);
        vm.prank(spender);
        vm.expectRevert(abi.encodeWithSelector(ScopedSpendManager.OverPerTxCap.selector, 11_00, 10_00));
        mgr.spend(id, merchant, 11_00);
    }
}
