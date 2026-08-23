// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BasePaymaster} from "account-abstraction/core/BasePaymaster.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {_packValidationData} from "account-abstraction/core/Helpers.sol";

interface IERC20Min {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

/**
 * @title UsdtPaymaster
 * @notice An ERC-4337 paymaster that charges gas in USD₮ instead of the native
 *         coin, for networks where no provider prices gas in USD₮.
 *
 *         Permissionless by design: there is no allowlist and no off-chain
 *         signature to obtain. Anyone who approves this contract for USD₮ can
 *         have their operations paid for, and they pay the actual cost —
 *         measured after execution — in USD₮. That keeps the accompanying
 *         ERC-7677 service stateless and keyless: it only has to name this
 *         address, because everything that matters is enforced here.
 *
 *         Pricing is an explicit `usdtPerNativeUnit` rate rather than an
 *         oracle. On a testnet an oracle would be quoting fictional prices
 *         anyway; on a live network this contract should read a real feed, and
 *         the rate here would become the fallback.
 */
contract UsdtPaymaster is BasePaymaster {
    error InsufficientAllowance(uint256 needed, uint256 actual);
    error InsufficientBalance(uint256 needed, uint256 actual);
    error PostOpChargeFailed();

    event Charged(address indexed account, uint256 gasCostWei, uint256 usdtCharged);
    event RateUpdated(uint256 usdtPerNativeUnit);

    IERC20Min public immutable usdt;

    /// USD₮ base units charged per 1e18 wei of gas. With USD₮ at 6 decimals,
    /// 2500e6 means "1 native coin costs 2500 USD₮".
    uint256 public usdtPerNativeUnit;

    /// Head-room over the EntryPoint's maxCost estimate, in percent, so a small
    /// gas-price move between validation and settlement cannot leave the
    /// paymaster unpaid. Charged amounts are still based on actual cost.
    uint256 public constant COST_MARGIN_PERCENT = 120;

    constructor(IEntryPoint entryPoint_, IERC20Min usdt_, uint256 usdtPerNativeUnit_)
        BasePaymaster(entryPoint_)
    {
        usdt = usdt_;
        usdtPerNativeUnit = usdtPerNativeUnit_;
        emit RateUpdated(usdtPerNativeUnit_);
    }

    function setRate(uint256 usdtPerNativeUnit_) external onlyOwner {
        usdtPerNativeUnit = usdtPerNativeUnit_;
        emit RateUpdated(usdtPerNativeUnit_);
    }

    /// @notice USD₮ owed for a given native-coin gas cost.
    function quote(uint256 gasCostWei) public view returns (uint256) {
        return (gasCostWei * usdtPerNativeUnit) / 1e18;
    }

    /// Validation only reads: the sender's USD₮ balance and its allowance to
    /// this contract. No state is written here, which is what the bundler's
    /// validation rules require. Reading another contract's storage is why this
    /// paymaster must be staked with the EntryPoint.
    function _validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32, uint256 maxCost)
        internal
        view
        override
        returns (bytes memory context, uint256 validationData)
    {
        uint256 needed = (quote(maxCost) * COST_MARGIN_PERCENT) / 100;

        uint256 allowed = usdt.allowance(userOp.sender, address(this));
        if (allowed < needed) revert InsufficientAllowance(needed, allowed);

        uint256 held = usdt.balanceOf(userOp.sender);
        if (held < needed) revert InsufficientBalance(needed, held);

        // Valid indefinitely, signature always considered good: authorisation
        // is the USD₮ approval itself, not a signed voucher.
        return (abi.encode(userOp.sender), _packValidationData(false, 0, 0));
    }

    /// Settlement: pull the real cost in USD₮. Runs whether the operation
    /// itself succeeded or reverted, because the gas was spent either way.
    function _postOp(PostOpMode, bytes calldata context, uint256 actualGasCost, uint256)
        internal
        override
    {
        address account = abi.decode(context, (address));
        uint256 owed = quote(actualGasCost);
        if (owed == 0) return;

        (bool ok, bytes memory data) = address(usdt).call(
            abi.encodeWithSelector(IERC20Min.transferFrom.selector, account, address(this), owed)
        );
        // Tolerates tokens that return no data (USDT's own quirk).
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert PostOpChargeFailed();

        emit Charged(account, actualGasCost, owed);
    }

    /// Sweep collected USD₮ to the owner.
    function withdrawUsdt(address to, uint256 amount) external onlyOwner {
        (bool ok, bytes memory data) = address(usdt).call(
            abi.encodeWithSelector(IERC20Min.transfer.selector, to, amount)
        );
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert PostOpChargeFailed();
    }
}
