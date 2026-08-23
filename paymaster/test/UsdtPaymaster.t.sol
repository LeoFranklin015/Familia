// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {UsdtPaymaster, IERC20Min} from "../src/UsdtPaymaster.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {IPaymaster} from "account-abstraction/interfaces/IPaymaster.sol";
import {MockERC20} from "./Mocks.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// BasePaymaster's constructor asserts the EntryPoint answers ERC-165 for
/// IEntryPoint, so the stub has to as well.
contract EntryPointStub is IERC165 {
    function supportsInterface(bytes4) external pure returns (bool) {
        return true;
    }
}

contract UsdtPaymasterTest is Test {
    UsdtPaymaster pm;
    MockERC20 usdt;
    address entryPoint;
    address account = makeAddr("account");

    // 1 native coin = 2500 USD₮ (6 decimals)
    uint256 constant RATE = 2500e6;

    function setUp() public {
        entryPoint = address(new EntryPointStub());
        usdt = new MockERC20("USDT", 6, false); // no-bool transferFrom, like real USDT
        pm = new UsdtPaymaster(IEntryPoint(entryPoint), IERC20Min(address(usdt)), RATE);
    }

    function _op() internal view returns (PackedUserOperation memory op) {
        op.sender = account;
    }

    function test_quoteConvertsGasToUsdt() public view {
        assertEq(pm.quote(1e18), 2500e6, "one whole coin of gas");
        assertEq(pm.quote(1e15), 2.5e6, "a milli-coin costs 2.50");
    }

    function test_validateAcceptsWhenApprovedAndFunded() public {
        uint256 maxCost = 1e15; // 2.50 USD₮ before margin
        usdt.mint(account, 100e6);
        vm.prank(account);
        usdt.approve(address(pm), 100e6);

        vm.prank(entryPoint);
        (bytes memory context, uint256 validationData) =
            pm.validatePaymasterUserOp(_op(), bytes32(0), maxCost);

        assertEq(validationData, 0, "valid, no time bounds");
        assertEq(abi.decode(context, (address)), account, "context carries the payer");
    }

    function test_revert_InsufficientAllowance() public {
        usdt.mint(account, 100e6); // funded but never approved
        vm.prank(entryPoint);
        vm.expectRevert(abi.encodeWithSelector(UsdtPaymaster.InsufficientAllowance.selector, 3e6, 0));
        pm.validatePaymasterUserOp(_op(), bytes32(0), 1e15);
    }

    function test_revert_InsufficientBalance() public {
        vm.prank(account);
        usdt.approve(address(pm), 100e6); // approved but holds nothing
        vm.prank(entryPoint);
        vm.expectRevert(abi.encodeWithSelector(UsdtPaymaster.InsufficientBalance.selector, 3e6, 0));
        pm.validatePaymasterUserOp(_op(), bytes32(0), 1e15);
    }

    function test_validateRequiresMarginAboveMaxCost() public {
        // Exactly maxCost is not enough: 120% of it is required.
        usdt.mint(account, 2.5e6);
        vm.prank(account);
        usdt.approve(address(pm), 2.5e6);
        vm.prank(entryPoint);
        vm.expectRevert(abi.encodeWithSelector(UsdtPaymaster.InsufficientAllowance.selector, 3e6, 2.5e6));
        pm.validatePaymasterUserOp(_op(), bytes32(0), 1e15);
    }

    function test_postOpChargesActualCostOnly() public {
        usdt.mint(account, 100e6);
        vm.prank(account);
        usdt.approve(address(pm), 100e6);

        // Validation reserved 3.00, but the operation really cost 1e15 wei.
        vm.prank(entryPoint);
        pm.postOp(IPaymaster.PostOpMode.opSucceeded, abi.encode(account), 1e15, 0);

        assertEq(usdt.balanceOf(account), 100e6 - 2.5e6, "charged the actual 2.50, not the reserve");
        assertEq(usdt.balanceOf(address(pm)), 2.5e6);
    }

    function test_postOpChargesEvenWhenTheOperationReverted() public {
        usdt.mint(account, 100e6);
        vm.prank(account);
        usdt.approve(address(pm), 100e6);
        vm.prank(entryPoint);
        pm.postOp(IPaymaster.PostOpMode.opReverted, abi.encode(account), 1e15, 0);
        assertEq(usdt.balanceOf(address(pm)), 2.5e6, "gas was still spent");
    }

    function test_onlyEntryPointCanValidateOrSettle() public {
        vm.expectRevert();
        pm.validatePaymasterUserOp(_op(), bytes32(0), 1e15);
        vm.expectRevert();
        pm.postOp(IPaymaster.PostOpMode.opSucceeded, abi.encode(account), 1e15, 0);
    }

    function test_ownerCanRepriceAndSweep() public {
        pm.setRate(1000e6);
        assertEq(pm.quote(1e18), 1000e6);

        usdt.mint(address(pm), 42e6);
        pm.withdrawUsdt(address(this), 42e6);
        assertEq(usdt.balanceOf(address(this)), 42e6);

        vm.prank(account);
        vm.expectRevert();
        pm.setRate(1);
    }
}
