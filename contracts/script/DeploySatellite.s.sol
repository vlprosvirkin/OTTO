// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {OTTOSatelliteDeployer} from "../src/deployers/OTTOSatelliteDeployer.sol";

/**
 * @notice Deploy OTTOSatelliteDeployer on satellite chains (Base Sepolia, Avalanche Fuji).
 *
 * Usage:
 *   forge script script/DeploySatellite.s.sol \
 *     --rpc-url $RPC_URL --private-key $KEY --broadcast
 */
contract DeploySatellite is Script {
    function run() external {
        vm.startBroadcast();
        OTTOSatelliteDeployer deployer = new OTTOSatelliteDeployer();
        vm.stopBroadcast();

        console.log("==========================================================");
        console.log("  OTTO Satellite Deployer");
        console.log("==========================================================");
        console.log("  SatelliteDeployer:", address(deployer));
        console.log("==========================================================");
        console.log("");
        console.log("  Set in frontend vault-config.ts:");
        console.log("  satelliteDeployer=", address(deployer));
    }
}
