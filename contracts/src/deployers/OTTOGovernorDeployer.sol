// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {OTTOGovernor} from "../OTTOGovernor.sol";

/**
 * @title OTTOGovernorDeployer
 * @notice Deploys OTTOGovernor via CREATE2. Kept separate to stay under 24KB.
 */
contract OTTOGovernorDeployer {

    function deploy(bytes32 salt, address token) external returns (address gov) {
        bytes memory bytecode = abi.encodePacked(
            type(OTTOGovernor).creationCode,
            abi.encode(IVotes(token))
        );
        gov = Create2.deploy(0, salt, bytecode);
    }

    function computeAddress(bytes32 salt, address token) external view returns (address) {
        bytes memory bytecode = abi.encodePacked(
            type(OTTOGovernor).creationCode,
            abi.encode(IVotes(token))
        );
        return Create2.computeAddress(salt, keccak256(bytecode));
    }
}
