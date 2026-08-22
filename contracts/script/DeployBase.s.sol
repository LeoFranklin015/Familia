// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ScopedSpendManager, IPool} from "../src/ScopedSpendManager.sol";
import {Simple7702Account} from "account-abstraction/accounts/Simple7702Account.sol";
import {AaveV3BaseSepolia, AaveV3BaseSepoliaAssets} from "aave-address-book/AaveV3BaseSepolia.sol";

/// Base Sepolia deployment. The manager's pool is Aave V3's real POOL, and a
/// scope's `source` is Aave's own aUSDT — no vault of ours anywhere. Base
/// Sepolia is used because its Aave USDT reserve is uncapped and freely
/// mintable, while Ethereum Sepolia's sits ~2x over its supply cap and reverts
/// with error 51 for any amount.
contract DeployBase is Script {
    function run() external {
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        Simple7702Account delegate = new Simple7702Account();
        ScopedSpendManager manager = new ScopedSpendManager(IPool(address(AaveV3BaseSepolia.POOL)));
        vm.stopBroadcast();

        console2.log("CHAIN_ID=84532");
        console2.log("DELEGATION_ADDRESS=", address(delegate));
        console2.log("SCOPED_SPEND_MANAGER_ADDRESS=", address(manager));
        console2.log("AAVE_POOL=", address(AaveV3BaseSepolia.POOL));
        console2.log("POOL_ASSET_USDT=", AaveV3BaseSepoliaAssets.USDT_UNDERLYING);
        console2.log("POOL_ASSET_AUSDT=", AaveV3BaseSepoliaAssets.USDT_A_TOKEN);
    }
}
