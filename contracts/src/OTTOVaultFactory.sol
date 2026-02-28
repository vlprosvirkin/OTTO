// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OTTOVault} from "./OTTOVault.sol";
import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";

/**
 * @title OTTOVaultFactory
 * @notice Deploys OTTOVault instances via CREATE2 for deterministic addresses.
 *
 *         Same factory address + same salt + same constructor args (minus USDC)
 *         = same vault address on every chain.
 *
 *         Flow:
 *         1. User calls deploy(salt, usdc, agent, ...) on each chain
 *         2. Factory deploys vault via CREATE2 (factory is temporary admin)
 *         3. Factory calls initializeUsdc(usdc) on the vault
 *         4. Factory transfers admin to msg.sender (the user)
 */
contract OTTOVaultFactory {

    event VaultDeployed(
        address indexed vault,
        address indexed owner,
        bytes32 salt,
        address usdc,
        address agent
    );

    /**
     * @notice Deploy a new OTTOVault at a deterministic address.
     * @param salt          User-chosen salt (recommend: keccak256(userAddress))
     * @param usdc          USDC token address on this chain
     * @param agent         OTTO agent address
     * @param maxPerTx      Max USDC per single transfer (6 decimals)
     * @param dailyLimit    Max USDC per day (6 decimals)
     * @param whitelistEnabled  Enable whitelist on deploy
     * @return vault        Address of the deployed vault
     */
    function deploy(
        bytes32 salt,
        address usdc,
        address agent,
        uint256 maxPerTx,
        uint256 dailyLimit,
        bool whitelistEnabled
    ) external returns (address vault) {
        // Constructor args do NOT include usdc → init code is chain-agnostic
        bytes memory bytecode = abi.encodePacked(
            type(OTTOVault).creationCode,
            abi.encode(agent, maxPerTx, dailyLimit, whitelistEnabled)
        );

        vault = Create2.deploy(0, salt, bytecode);

        // Factory is admin right now — set chain-specific USDC
        OTTOVault(vault).initializeUsdc(usdc);

        // Transfer admin to the actual caller
        OTTOVault(vault).transferAdmin(msg.sender);

        emit VaultDeployed(vault, msg.sender, salt, usdc, agent);
    }

    /**
     * @notice Predict the deterministic vault address before deployment.
     * @dev USDC is not part of the computation — same address regardless of chain.
     */
    function computeAddress(
        bytes32 salt,
        address agent,
        uint256 maxPerTx,
        uint256 dailyLimit,
        bool whitelistEnabled
    ) external view returns (address) {
        bytes memory bytecode = abi.encodePacked(
            type(OTTOVault).creationCode,
            abi.encode(agent, maxPerTx, dailyLimit, whitelistEnabled)
        );
        return Create2.computeAddress(salt, keccak256(bytecode));
    }
}
