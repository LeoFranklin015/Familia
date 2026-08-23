// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {UsdtPaymaster, IERC20Min} from "../src/UsdtPaymaster.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {AaveV3BaseSepoliaAssets} from "aave-address-book/AaveV3BaseSepolia.sol";

/// Deploys the USD₮ paymaster on Base Sepolia, funds its EntryPoint deposit
/// (which is what actually pays the bundler in native coin) and stakes it.
///
/// The stake is not optional: `_validatePaymasterUserOp` reads the sender's
/// USD₮ balance and allowance — another contract's storage — and ERC-7562
/// only permits that from a staked paymaster. Without it, bundlers reject
/// every operation.
contract DeployPaymaster is Script {
    IEntryPoint constant ENTRY_POINT = IEntryPoint(0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108);

    /// 1 ETH == 2500 USD₮. A demo rate, set explicitly rather than pretending
    /// a testnet oracle means anything.
    uint256 constant USDT_PER_NATIVE = 2500e6;

    function run() external {
        uint256 deposit = vm.envOr("PAYMASTER_DEPOSIT_WEI", uint256(0.05 ether));
        uint256 stake = vm.envOr("PAYMASTER_STAKE_WEI", uint256(0.05 ether));
        uint32 unstakeDelay = uint32(vm.envOr("PAYMASTER_UNSTAKE_DELAY", uint256(86400)));

        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        UsdtPaymaster pm = new UsdtPaymaster(
            ENTRY_POINT, IERC20Min(AaveV3BaseSepoliaAssets.USDT_UNDERLYING), USDT_PER_NATIVE
        );
        pm.deposit{value: deposit}();
        pm.addStake{value: stake}(unstakeDelay);
        vm.stopBroadcast();

        console2.log("USDT_PAYMASTER_ADDRESS=", address(pm));
        console2.log("deposit (wei)=", deposit);
        console2.log("stake (wei)=", stake);
        console2.log("rate: 1 native =", USDT_PER_NATIVE / 1e6, "USDT");
    }
}
