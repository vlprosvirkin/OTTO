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
 *   - Voting period:    345600 blocks (~48 hours on Arc Testnet at 0.5s/block)
 *   - Proposal threshold: 0 (any holder can propose)
 *   - Quorum:           51% of total supply
 *   - No timelock (proposals execute immediately)
 *   - Early execution: proposals can be executed as soon as quorum is met
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
        GovernorSettings(1, 345_600, 0)
    {}

    // ─── Early Execution ──────────────────────────────────────────────────────

    /// @notice Allows executing proposals as soon as quorum is reached and vote passes,
    ///         without waiting for the full 48-hour voting period to end.
    function state(uint256 proposalId)
        public view override(Governor) returns (ProposalState)
    {
        ProposalState s = super.state(proposalId);

        if (s == ProposalState.Active && _quorumReached(proposalId) && _voteSucceeded(proposalId)) {
            return ProposalState.Succeeded;
        }

        return s;
    }

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
