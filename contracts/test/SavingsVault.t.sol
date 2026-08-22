// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {SavingsVault, IERC20Min} from "../src/SavingsVault.sol";
import {ScopedSpendManager, IPool} from "../src/ScopedSpendManager.sol";
import {MockERC20} from "./Mocks.sol";

/// The vault must be indistinguishable from an Aave pool + aToken pair as far
/// as ScopedSpendManager is concerned — that equivalence is what lets the same
/// deployment point at Aave on mainnet.
contract SavingsVaultTest is Test {
    MockERC20 usdt;
    SavingsVault vault;
    ScopedSpendManager mgr;

    address funder = makeAddr("funder");
    address spender = makeAddr("spender");
    address merchant = makeAddr("merchant");

    function setUp() public {
        usdt = new MockERC20("USDT", 6, false); // no-bool transferFrom, like real USDT
        vault = new SavingsVault(IERC20Min(address(usdt)), 6);
        mgr = new ScopedSpendManager(IPool(address(vault)));

        usdt.mint(funder, 500_000000);
        vm.startPrank(funder);
        usdt.approve(address(vault), 500_000000);
        vault.deposit(500_000000);
        vault.approve(address(mgr), type(uint128).max);
        vm.stopPrank();
    }

    function test_depositCreditsSharesOneForOne() public view {
        assertEq(vault.balanceOf(funder), 500_000000);
        assertEq(vault.totalSupply(), 500_000000);
        assertEq(usdt.balanceOf(address(vault)), 500_000000);
    }

    function test_spendRedeemsFromVaultStraightToMerchant() public {
        vm.prank(funder);
        bytes32 id = mgr.grant(spender, address(usdt), address(vault), 50_000000, 120_000000, 7 days, 0);

        vm.prank(spender);
        mgr.spend(id, merchant, 8_000000);

        assertEq(usdt.balanceOf(merchant), 8_000000, "merchant paid in USDT");
        assertEq(vault.balanceOf(funder), 492_000000, "funder's position reduced");
        assertEq(vault.balanceOf(address(mgr)), 0, "manager custodies nothing");
        assertEq(vault.totalSupply(), usdt.balanceOf(address(vault)), "shares stay fully backed");
    }

    function test_spendableReadsThroughToTheVaultPosition() public {
        vm.prank(funder);
        bytes32 id = mgr.grant(spender, address(usdt), address(vault), 50_000000, 120_000000, 7 days, 0);
        assertEq(mgr.spendable(id), 50_000000);

        // draining the position is reflected truthfully, without reverting
        vm.prank(funder);
        vault.withdraw(address(usdt), 497_000000, funder);
        assertEq(mgr.spendable(id), 3_000000);
    }

    function test_revert_WrongAsset() public {
        MockERC20 other = new MockERC20("OTHER", 6, true);
        vm.prank(funder);
        vm.expectRevert(SavingsVault.WrongAsset.selector);
        vault.withdraw(address(other), 1, funder);
    }

    function test_revert_InsufficientShares() public {
        vm.prank(merchant); // holds nothing
        vm.expectRevert(SavingsVault.InsufficientShares.selector);
        vault.withdraw(address(usdt), 1, merchant);
    }

    function test_withdrawPaysArbitraryRecipient() public {
        vm.prank(funder);
        vault.withdraw(address(usdt), 10_000000, merchant);
        assertEq(usdt.balanceOf(merchant), 10_000000);
        assertEq(vault.balanceOf(funder), 490_000000);
    }
}
