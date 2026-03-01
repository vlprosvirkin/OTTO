// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";
import {OTTOSatelliteVault} from "../OTTOSatelliteVault.sol";

/**
 * @title OTTOSatelliteDeployer
 * @notice Deploys OTTOSatelliteVault via CREATE2 on satellite chains.
 *         Transfers CEO to caller so the user owns the vault.
 *
 * Deploy this once per satellite chain. Frontend calls deploy() directly.
 */
contract OTTOSatelliteDeployer {

    event SatelliteDeployed(address indexed vault, address indexed ceo, bytes32 salt);

    function deploy(
        bytes32 salt,
        address usdc,
        address agent,
        uint256 maxPerTx,
        uint256 dailyLimit,
        bool whitelistEnabled
    ) external returns (address vault) {
        bytes memory bytecode = abi.encodePacked(
            type(OTTOSatelliteVault).creationCode,
            abi.encode(usdc, agent, maxPerTx, dailyLimit, whitelistEnabled)
        );
        vault = Create2.deploy(0, salt, bytecode);
        // Transfer CEO from this deployer to the caller
        OTTOSatelliteVault(vault).transferCeo(msg.sender);
        emit SatelliteDeployed(vault, msg.sender, salt);
    }

    function computeAddress(
        bytes32 salt,
        address usdc,
        address agent,
        uint256 maxPerTx,
        uint256 dailyLimit,
        bool whitelistEnabled
    ) external view returns (address) {
        bytes memory bytecode = abi.encodePacked(
            type(OTTOSatelliteVault).creationCode,
            abi.encode(usdc, agent, maxPerTx, dailyLimit, whitelistEnabled)
        );
        return Create2.computeAddress(salt, keccak256(bytecode));
    }
}
