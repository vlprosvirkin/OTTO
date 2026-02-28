// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {OTTOVault} from "../src/OTTOVault.sol";

/**
 * @notice Deploy OTTOVault to any supported chain.
 *
 * Usage:
 *   # Arc Testnet
 *   forge script script/Deploy.s.sol \
 *     --rpc-url arc_testnet --private-key $DEPLOYER_PRIVATE_KEY --broadcast
 *
 *   # Base Sepolia
 *   USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e \
 *   forge script script/Deploy.s.sol \
 *     --rpc-url base_sepolia --private-key $DEPLOYER_PRIVATE_KEY --broadcast
 *
 *   # Avalanche Fuji
 *   USDC_ADDRESS=0x5425890298aed601595a70ab815c96711a31bc65 \
 *   forge script script/Deploy.s.sol \
 *     --rpc-url fuji --private-key $DEPLOYER_PRIVATE_KEY --broadcast
 *
 * Environment variables:
 *   DEPLOYER_PRIVATE_KEY   — deployer wallet (becomes admin)
 *   AGENT_ADDRESS          — OTTO agent wallet address
 *   USDC_ADDRESS           — USDC token address on the target chain
 *                            (defaults to Arc Testnet USDC if not set)
 *   MAX_PER_TX_USDC        — per-tx limit in whole USDC (default: 10)
 *   DAILY_LIMIT_USDC       — daily limit in whole USDC (default: 100)
 *   WHITELIST_ENABLED      — "true" to enable whitelist (default: false)
 */
contract DeployOTTOVault is Script {

    // Default: Arc Testnet USDC (override with USDC_ADDRESS env var for other chains)
    address constant USDC_ARC_DEFAULT = 0x3600000000000000000000000000000000000000;

    function run() external {
        address usdc  = vm.envOr("USDC_ADDRESS", USDC_ARC_DEFAULT);
        address agent = vm.envAddress("AGENT_ADDRESS");

        uint256 maxPerTxUsdc   = _envUint("MAX_PER_TX_USDC",   10);
        uint256 dailyLimitUsdc = _envUint("DAILY_LIMIT_USDC", 100);
        bool    whitelist      = _envBool("WHITELIST_ENABLED", false);

        // Convert whole USDC to 6-decimal units
        uint256 maxPerTx   = maxPerTxUsdc   * 1e6;
        uint256 dailyLimit = dailyLimitUsdc * 1e6;

        vm.startBroadcast();

        OTTOVault vault = new OTTOVault(
            agent,
            maxPerTx,
            dailyLimit,
            whitelist
        );
        vault.initializeUsdc(usdc);

        vm.stopBroadcast();

        console.log("=================================================");
        console.log("  OTTOVault deployed on Arc Testnet");
        console.log("=================================================");
        console.log("  Address:          ", address(vault));
        console.log("  Admin:            ", vault.admin());
        console.log("  Agent:            ", vault.agent());
        console.log("  Max per tx:       ", maxPerTxUsdc, "USDC");
        console.log("  Daily limit:      ", dailyLimitUsdc, "USDC");
        console.log("  Whitelist:        ", whitelist);
        console.log("=================================================");
        console.log("");
        console.log("  Next: deposit USDC to the vault:");
        console.log("  cast send", address(vault),
            "\"deposit(uint256)\" <amount_in_6_decimals>",
            "--rpc-url arc_testnet --private-key $DEPLOYER_PRIVATE_KEY");
        console.log("");
        console.log("  Add VAULT_ADDRESS to your .env:");
        console.log("  VAULT_ADDRESS=", address(vault));
    }

    function _envUint(string memory key, uint256 defaultVal) internal view returns (uint256) {
        try vm.envUint(key) returns (uint256 val) { return val; }
        catch { return defaultVal; }
    }

    function _envBool(string memory key, bool defaultVal) internal view returns (bool) {
        try vm.envBool(key) returns (bool val) { return val; }
        catch { return defaultVal; }
    }
}
