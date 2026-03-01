// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OTTOShareToken} from "./OTTOShareToken.sol";
import {OTTOVaultV2} from "./OTTOVaultV2.sol";
import {OTTORegistry} from "./OTTORegistry.sol";
import {OTTOTokenDeployer} from "./deployers/OTTOTokenDeployer.sol";
import {OTTOGovernorDeployer} from "./deployers/OTTOGovernorDeployer.sol";
import {OTTOVaultDeployer} from "./deployers/OTTOVaultDeployer.sol";

/**
 * @title OTTOVaultFactoryV2
 * @notice Orchestrates deployment of the full V2 treasury stack via sub-deployers.
 *
 * Split into 3 sub-deployers to stay under the 24KB EVM contract size limit:
 *   - OTTOTokenDeployer:     deploys OTTOShareToken
 *   - OTTOGovernorDeployer:  deploys OTTOGovernor
 *   - OTTOVaultDeployer:     deploys OTTOVaultV2
 *
 * This factory orchestrates all 3, wires them together, registers in OTTORegistry,
 * and transfers CEO to the caller.
 *
 * CREATE2 determinism: same deployers + same salt + same args = same addresses on every chain.
 * USDC is excluded from CREATE2 computation for cross-chain address consistency.
 */
contract OTTOVaultFactoryV2 {

    OTTOTokenDeployer    public immutable tokenDeployer;
    OTTOGovernorDeployer public immutable governorDeployer;
    OTTOVaultDeployer    public immutable vaultDeployer;
    OTTORegistry         public immutable registry;

    event V2Deployed(
        address indexed vault,
        address indexed token,
        address indexed governor,
        address ceo,
        bytes32 salt
    );

    constructor(
        address _tokenDeployer,
        address _governorDeployer,
        address _vaultDeployer,
        address _registry
    ) {
        tokenDeployer    = OTTOTokenDeployer(_tokenDeployer);
        governorDeployer = OTTOGovernorDeployer(_governorDeployer);
        vaultDeployer    = OTTOVaultDeployer(_vaultDeployer);
        registry         = OTTORegistry(_registry);
    }

    /**
     * @notice Deploy the full V2 treasury stack.
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

        // 1. Deploy share token via sub-deployer
        token = tokenDeployer.deploy(salt, shareholders, sharesBps);

        // 2. Deploy governor via sub-deployer
        bytes32 govSalt = keccak256(abi.encodePacked(salt, "governor"));
        gov = governorDeployer.deploy(govSalt, token);

        // 3. Deploy vault via sub-deployer (CEO transferred to this factory)
        bytes32 vaultSalt = keccak256(abi.encodePacked(salt, "vault"));
        vault = vaultDeployer.deploy(vaultSalt, agent, maxPerTx, dailyLimit, whitelistEnabled);

        // 4. Wire up (one-time init functions, no access control needed)
        OTTOShareToken(token).setVault(vault);
        OTTOVaultV2(vault).initializeUsdc(usdc);
        OTTOVaultV2(vault).setShareToken(token);
        OTTOVaultV2(vault).setGovernor(gov);

        // 5. Transfer CEO from factory to the caller
        OTTOVaultV2(vault).transferCeo(msg.sender);

        // 6. Register in on-chain registry
        registry.register(salt, vault, token, gov, msg.sender);

        emit V2Deployed(vault, token, gov, msg.sender, salt);
    }

    /**
     * @notice Predict deterministic addresses before deployment.
     * @dev USDC is excluded — same addresses regardless of chain.
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
        token = tokenDeployer.computeAddress(salt, shareholders, sharesBps);

        bytes32 govSalt = keccak256(abi.encodePacked(salt, "governor"));
        gov = governorDeployer.computeAddress(govSalt, token);

        bytes32 vaultSalt = keccak256(abi.encodePacked(salt, "vault"));
        vault = vaultDeployer.computeAddress(vaultSalt, agent, maxPerTx, dailyLimit, whitelistEnabled);
    }
}
