// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";
import {OTTOShareToken} from "../OTTOShareToken.sol";

/**
 * @title OTTOTokenDeployer
 * @notice Deploys OTTOShareToken via CREATE2. Kept separate to stay under 24KB.
 */
contract OTTOTokenDeployer {

    function deploy(
        bytes32 salt,
        address[] calldata shareholders,
        uint256[] calldata sharesBps
    ) external returns (address token) {
        bytes memory bytecode = abi.encodePacked(
            type(OTTOShareToken).creationCode,
            abi.encode("OTTO Shares", "OTTOS", shareholders, sharesBps)
        );
        token = Create2.deploy(0, salt, bytecode);
    }

    function computeAddress(
        bytes32 salt,
        address[] calldata shareholders,
        uint256[] calldata sharesBps
    ) external view returns (address) {
        bytes memory bytecode = abi.encodePacked(
            type(OTTOShareToken).creationCode,
            abi.encode("OTTO Shares", "OTTOS", shareholders, sharesBps)
        );
        return Create2.computeAddress(salt, keccak256(bytecode));
    }
}
