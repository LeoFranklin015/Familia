// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {SavingsVault, IERC20Min} from "../src/SavingsVault.sol";
import {ScopedSpendManager, IPool} from "../src/ScopedSpendManager.sol";
import {AaveV3SepoliaAssets} from "aave-address-book/AaveV3Sepolia.sol";

/// Deploys the USD₮ savings position and a manager bound to it.
/// The underlying is Aave's Sepolia testnet USDT — a real Tether-branded test
/// token that the Aave faucet mints freely. Only *supplying* it to Aave is
/// impossible there (the reserve is ~2x over its supply cap), so the savings
/// leg is served by SavingsVault behind Aave's own pool interface.
contract DeployUsdt is Script {
    function run() external {
        address usdt = AaveV3SepoliaAssets.USDT_UNDERLYING;

        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        SavingsVault vault = new SavingsVault(IERC20Min(usdt), 6);
        ScopedSpendManager manager = new ScopedSpendManager(IPool(address(vault)));
        vm.stopBroadcast();

        console2.log("POOL_ASSET (USDT)=", usdt);
        console2.log("SAVINGS_VAULT=", address(vault));
        console2.log("SCOPED_SPEND_MANAGER_ADDRESS=", address(manager));
    }
}
