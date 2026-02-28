// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {OTTOShareToken} from "./OTTOShareToken.sol";
import {OTTOVaultV2} from "./OTTOVaultV2.sol";
import {OTTOGovernor} from "./OTTOGovernor.sol";

/**
 * @title OTTOVaultFactoryV2
 * @notice Atomic CREATE2 deployment of the full V2 treasury stack:
 *         OTTOShareToken + OTTOGovernor + OTTOVaultV2.
 *
 * Same factory + same salt + same constructor args (minus USDC)
 * = same addresses on every chain.
 *
 * Flow:
 *   1. Deploy OTTOShareToken (CREATE2 with salt)
 *   2. Deploy OTTOGovernor (CREATE2 with derived salt)
 *   3. Deploy OTTOVaultV2 (CREATE2 with derived salt)
 *   4. Wire: token ↔ vault ↔ governor
 *   5. Transfer CEO to msg.sender
 */
contract OTTOVaultFactoryV2 {

    event V2Deployed(
        address indexed vault,
        address indexed token,
        address indexed governor,
        address ceo,
        bytes32 salt
    );

    /**
     * @notice Deploy the full V2 treasury stack atomically.
     * @param salt              User-chosen salt for deterministic deployment
     * @param usdc              USDC token address on this chain
     * @param agent             OTTO agent address
     * @param maxPerTx          Max USDC per agent transfer (6 decimals)
     * @param dailyLimit        Max USDC per day (6 decimals)
     * @param whitelistEnabled  Enable whitelist on deploy
     * @param shareholders      Array of shareholder addresses
     * @param sharesBps         Array of shares in basis points (must sum to 10000)
     * @return vault            Deployed OTTOVaultV2 address
     * @return token            Deployed OTTOShareToken address
     * @return gov              Deployed OTTOGovernor address
     */
    function deploy(
        bytes32 salt,
        address usdc,
        address agent,
        uint256 maxPerTx,
        uint256 dailyLimit,
        bool whitelistEnabled,
        address[] calldata shareholders,
        uint256[] calldata sharesBps
    ) external returns (address vault, address token, address gov) {

        // 1. Deploy share token
        bytes memory tokenBytecode = abi.encodePacked(
            type(OTTOShareToken).creationCode,
            abi.encode("OTTO Shares", "OTTOS", shareholders, sharesBps)
        );
        token = Create2.deploy(0, salt, tokenBytecode);

        // 2. Deploy governor
        bytes32 govSalt = keccak256(abi.encodePacked(salt, "governor"));
        bytes memory govBytecode = abi.encodePacked(
            type(OTTOGovernor).creationCode,
            abi.encode(token)
        );
        gov = Create2.deploy(0, govSalt, govBytecode);

        // 3. Deploy vault (USDC excluded from bytecode for cross-chain determinism)
        bytes32 vaultSalt = keccak256(abi.encodePacked(salt, "vault"));
        bytes memory vaultBytecode = abi.encodePacked(
            type(OTTOVaultV2).creationCode,
            abi.encode(agent, maxPerTx, dailyLimit, whitelistEnabled)
        );
        vault = Create2.deploy(0, vaultSalt, vaultBytecode);

        // 4. Wire up
        OTTOShareToken(token).setVault(vault);
        OTTOVaultV2(vault).initializeUsdc(usdc);
        OTTOVaultV2(vault).setShareToken(token);
        OTTOVaultV2(vault).setGovernor(gov);

        // 5. Transfer CEO to the actual caller
        OTTOVaultV2(vault).transferCeo(msg.sender);

        emit V2Deployed(vault, token, gov, msg.sender, salt);
    }

    /**
     * @notice Predict deterministic addresses before deployment.
     * @dev USDC is not part of computation — same addresses regardless of chain.
     */
    function computeAddress(
        bytes32 salt,
        address agent,
        uint256 maxPerTx,
        uint256 dailyLimit,
        bool whitelistEnabled,
        address[] calldata shareholders,
        uint256[] calldata sharesBps
    ) external view returns (address vault, address token, address gov) {
        bytes memory tokenBytecode = abi.encodePacked(
            type(OTTOShareToken).creationCode,
            abi.encode("OTTO Shares", "OTTOS", shareholders, sharesBps)
        );
        token = Create2.computeAddress(salt, keccak256(tokenBytecode));

        bytes32 govSalt = keccak256(abi.encodePacked(salt, "governor"));
        bytes memory govBytecode = abi.encodePacked(
            type(OTTOGovernor).creationCode,
            abi.encode(token)
        );
        gov = Create2.computeAddress(govSalt, keccak256(govBytecode));

        bytes32 vaultSalt = keccak256(abi.encodePacked(salt, "vault"));
        bytes memory vaultBytecode = abi.encodePacked(
            type(OTTOVaultV2).creationCode,
            abi.encode(agent, maxPerTx, dailyLimit, whitelistEnabled)
        );
        vault = Create2.computeAddress(vaultSalt, keccak256(vaultBytecode));
    }
}
