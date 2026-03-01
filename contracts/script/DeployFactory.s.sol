// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {OTTOTokenDeployer} from "../src/deployers/OTTOTokenDeployer.sol";
import {OTTOGovernorDeployer} from "../src/deployers/OTTOGovernorDeployer.sol";
import {OTTOVaultDeployer} from "../src/deployers/OTTOVaultDeployer.sol";
import {OTTOVaultFactoryV2} from "../src/OTTOVaultFactoryV2.sol";
import {OTTORegistry} from "../src/OTTORegistry.sol";

/**
 * @notice Deploy the split factory infrastructure (one-time per chain).
 *
 * Deploys: 3 sub-deployers + OTTORegistry + OTTOVaultFactoryV2
 *
 * Usage:
 *   forge script script/DeployFactory.s.sol \
 *     --rpc-url arc_testnet --private-key $KEY --broadcast
 */
contract DeployFactory is Script {
    function run() external {
        // Optionally reuse existing registry
        address regAddr = vm.envOr("REGISTRY_ADDRESS", address(0));

        vm.startBroadcast();

        // 1. Deploy sub-deployers
        OTTOTokenDeployer    tokenDep = new OTTOTokenDeployer();
        OTTOGovernorDeployer govDep   = new OTTOGovernorDeployer();
        OTTOVaultDeployer    vaultDep = new OTTOVaultDeployer();

        // 2. Deploy or reuse registry
        OTTORegistry registry;
        if (regAddr != address(0)) {
            registry = OTTORegistry(regAddr);
        } else {
            registry = new OTTORegistry();
        }

        // 3. Deploy factory
        OTTOVaultFactoryV2 factory = new OTTOVaultFactoryV2(
            address(tokenDep),
            address(govDep),
            address(vaultDep),
            address(registry)
        );

        vm.stopBroadcast();

        console.log("==========================================================");
        console.log("  OTTO V2 Factory Infrastructure - Deployed");
        console.log("==========================================================");
        console.log("  TokenDeployer:    ", address(tokenDep));
        console.log("  GovernorDeployer: ", address(govDep));
        console.log("  VaultDeployer:    ", address(vaultDep));
        console.log("  Registry:         ", address(registry));
        console.log("  Factory:          ", address(factory));
        console.log("==========================================================");
        console.log("");
        console.log("  Set in frontend vault-config.ts:");
        console.log("  FACTORY_ADDRESS=", address(factory));
    }
}
