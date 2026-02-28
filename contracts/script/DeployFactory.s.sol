// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {OTTOVaultFactory} from "../src/OTTOVaultFactory.sol";

/**
 * @notice Deploy OTTOVaultFactory on a chain.
 *
 * To get the SAME factory address on all chains, deploy from the same
 * wallet with the same nonce on each chain:
 *
 *   forge script script/DeployFactory.s.sol --rpc-url arc_testnet    --private-key $KEY --broadcast
 *   forge script script/DeployFactory.s.sol --rpc-url base_sepolia   --private-key $KEY --broadcast
 *   forge script script/DeployFactory.s.sol --rpc-url avalanche_fuji --private-key $KEY --broadcast
 */
contract DeployFactory is Script {
    function run() external {
        vm.startBroadcast();
        OTTOVaultFactory factory = new OTTOVaultFactory();
        vm.stopBroadcast();

        console.log("OTTOVaultFactory deployed at:", address(factory));
    }
}
