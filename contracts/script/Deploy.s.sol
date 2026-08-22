// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ScopedSpendManager, IPool} from "../src/ScopedSpendManager.sol";
import {Simple7702Account} from "account-abstraction/accounts/Simple7702Account.sol";
import {AaveV3Sepolia} from "aave-address-book/AaveV3Sepolia.sol";

/// Deploys the EIP-7702 delegate (eth-infinitism Simple7702Account, v0.8 —
/// stateless, no constructor args) and the ScopedSpendManager bound to the
/// Aave V3 Sepolia pool.
contract Deploy is Script {
    function run() external {
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        Simple7702Account delegate = new Simple7702Account();
        ScopedSpendManager manager = new ScopedSpendManager(IPool(address(AaveV3Sepolia.POOL)));
        vm.stopBroadcast();

        console2.log("DELEGATION_ADDRESS=", address(delegate));
        console2.log("SCOPED_SPEND_MANAGER_ADDRESS=", address(manager));
    }
}
