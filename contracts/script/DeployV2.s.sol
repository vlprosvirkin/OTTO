// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {OTTOVaultV2} from "../src/OTTOVaultV2.sol";
import {OTTOShareToken} from "../src/OTTOShareToken.sol";
import {OTTOGovernor} from "../src/OTTOGovernor.sol";
import {OTTORegistry} from "../src/OTTORegistry.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";

/**
 * @notice Deploy OTTOVaultV2 governance treasury stack (individual contracts + registry).
 *
 * Deploys OTTOShareToken, OTTOGovernor, OTTOVaultV2 separately (avoids 24KB factory limit),
 * wires them together, and registers in OTTORegistry.
 *
 * Usage:
 *   SHAREHOLDERS="0xAlice,0xBob" SHARES_BPS="6000,4000" \
 *   AGENT_ADDRESS=0x... SALT=my-company-vault \
 *   forge script script/DeployV2.s.sol \
 *     --rpc-url arc_testnet --private-key $DEPLOYER_PRIVATE_KEY --broadcast
 *
 * Environment variables:
 *   DEPLOYER_PRIVATE_KEY  - deployer wallet (becomes CEO)
 *   AGENT_ADDRESS         - OTTO agent wallet address
 *   USDC_ADDRESS          - USDC token address (defaults to Arc Testnet USDC)
 *   SHAREHOLDERS          - comma-separated shareholder addresses
 *   SHARES_BPS            - comma-separated basis points (must sum to 10000)
 *   SALT                  - human-readable salt for registry key
 *   MAX_PER_TX_USDC       - per-tx limit in whole USDC (default: 10)
 *   DAILY_LIMIT_USDC      - daily limit in whole USDC (default: 100)
 *   WHITELIST_ENABLED     - "true" to enable whitelist (default: false)
 *   REGISTRY_ADDRESS      - existing registry address (deploys new if not set)
 */
contract DeployV2 is Script {

    address constant USDC_ARC_DEFAULT = 0x3600000000000000000000000000000000000000;

    function run() external {
        address usdc  = vm.envOr("USDC_ADDRESS", USDC_ARC_DEFAULT);
        address agent = vm.envAddress("AGENT_ADDRESS");
        string memory saltStr = vm.envOr("SALT", string("otto-vault-v2"));

        uint256 maxPerTxUsdc   = _envUint("MAX_PER_TX_USDC",   10);
        uint256 dailyLimitUsdc = _envUint("DAILY_LIMIT_USDC", 100);
        bool    whitelist      = _envBool("WHITELIST_ENABLED", false);

        // Parse shareholders
        address[] memory shareholders = vm.envAddress("SHAREHOLDERS", ",");
        uint256[] memory sharesBps    = vm.envUint("SHARES_BPS", ",");

        require(shareholders.length == sharesBps.length, "shareholders/bps length mismatch");
        require(shareholders.length > 0, "need at least 1 shareholder");

        uint256 maxPerTx   = maxPerTxUsdc   * 1e6;
        uint256 dailyLimit = dailyLimitUsdc * 1e6;
        bytes32 salt = keccak256(abi.encodePacked(saltStr));

        vm.startBroadcast();

        // 1. Deploy Registry (or reuse existing)
        OTTORegistry registry;
        address regAddr = vm.envOr("REGISTRY_ADDRESS", address(0));
        if (regAddr != address(0)) {
            registry = OTTORegistry(regAddr);
        } else {
            registry = new OTTORegistry();
        }

        // 2. Deploy ShareToken
        OTTOShareToken token = new OTTOShareToken(
            "OTTO Shares", "OTTOS", shareholders, sharesBps
        );

        // 3. Deploy Governor
        OTTOGovernor gov = new OTTOGovernor(IVotes(address(token)));

        // 4. Deploy Vault
        OTTOVaultV2 vault = new OTTOVaultV2(agent, maxPerTx, dailyLimit, whitelist);

        // 5. Wire up
        token.setVault(address(vault));
        vault.initializeUsdc(usdc);
        vault.setShareToken(address(token));
        vault.setGovernor(address(gov));
        vault.transferCeo(msg.sender);

        // 6. Register in registry
        registry.register(salt, address(vault), address(token), address(gov), msg.sender);

        vm.stopBroadcast();

        console.log("==========================================================");
        console.log("  OTTO V2 Governance Treasury - Deployed");
        console.log("==========================================================");
        console.log("  Registry:        ", address(registry));
        console.log("  Vault:           ", address(vault));
        console.log("  Share Token:     ", address(token));
        console.log("  Governor:        ", address(gov));
        console.log("  CEO:             ", vault.ceo());
        console.log("  Agent:           ", agent);
        console.log("  Max per tx:      ", maxPerTxUsdc, "USDC");
        console.log("  Daily limit:     ", dailyLimitUsdc, "USDC");
        console.log("  Whitelist:       ", whitelist);
        console.log("  Shareholders:    ", shareholders.length);
        console.log("==========================================================");
        console.log("");
        console.log("  Add to your .env:");
        console.log("  REGISTRY_ADDRESS=", address(registry));
        console.log("  VAULT_V2_ADDRESS=", address(vault));
        console.log("  SHARE_TOKEN_ADDRESS=", address(token));
        console.log("  GOVERNOR_ADDRESS=", address(gov));
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
