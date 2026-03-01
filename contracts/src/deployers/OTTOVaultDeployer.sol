// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";
import {OTTOVaultV2} from "../OTTOVaultV2.sol";

/**
 * @title OTTOVaultDeployer
 * @notice Deploys OTTOVaultV2 via CREATE2. Transfers CEO to caller (factory).
 */
contract OTTOVaultDeployer {

    function deploy(
        bytes32 salt,
        address agent,
        uint256 maxPerTx,
        uint256 dailyLimit,
        bool whitelistEnabled
    ) external returns (address vault) {
        bytes memory bytecode = abi.encodePacked(
            type(OTTOVaultV2).creationCode,
            abi.encode(agent, maxPerTx, dailyLimit, whitelistEnabled)
        );
        vault = Create2.deploy(0, salt, bytecode);
        // Vault constructor sets ceo = address(this). Transfer to caller (factory)
        // so factory can wire up and then transfer to end user.
        OTTOVaultV2(vault).transferCeo(msg.sender);
    }

    function computeAddress(
        bytes32 salt,
        address agent,
        uint256 maxPerTx,
        uint256 dailyLimit,
        bool whitelistEnabled
    ) external view returns (address) {
        bytes memory bytecode = abi.encodePacked(
            type(OTTOVaultV2).creationCode,
            abi.encode(agent, maxPerTx, dailyLimit, whitelistEnabled)
        );
        return Create2.computeAddress(salt, keccak256(bytecode));
    }
}
