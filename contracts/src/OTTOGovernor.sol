// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Governor} from "@openzeppelin/contracts/governance/Governor.sol";
import {GovernorCountingSimple} from "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import {GovernorVotes} from "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import {GovernorVotesQuorumFraction} from "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import {GovernorSettings} from "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";

/**
 * @title OTTOGovernor
 * @notice Minimal on-chain governance for OTTOVault V2.
 *
 * Shareholders vote using OTTOShareToken (ERC20Votes).
 * Controls: setCeo(), dissolve() on the linked vault.
 *
 * MVP settings (testnet):
 *   - Voting delay:     1 block
 *   - Voting period:    100 blocks (~5 min on Arc Testnet)
 *   - Proposal threshold: 0 (any holder can propose)
 *   - Quorum:           51% of total supply
 *   - No timelock (proposals execute immediately)
 */
contract OTTOGovernor is
    Governor,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorVotesQuorumFraction,
    GovernorSettings
{
    constructor(IVotes _token)
        Governor("OTTOGovernor")
        GovernorVotes(_token)
        GovernorVotesQuorumFraction(51)
        GovernorSettings(1, 100, 0)
    {}

    // ─── Required Diamond Overrides ──────────────────────────────────────────

    function votingDelay()
        public view override(Governor, GovernorSettings) returns (uint256)
    { return super.votingDelay(); }

    function votingPeriod()
        public view override(Governor, GovernorSettings) returns (uint256)
    { return super.votingPeriod(); }

    function proposalThreshold()
        public view override(Governor, GovernorSettings) returns (uint256)
    { return super.proposalThreshold(); }

    function quorum(uint256 timepoint)
        public view override(Governor, GovernorVotesQuorumFraction) returns (uint256)
    { return super.quorum(timepoint); }
}
