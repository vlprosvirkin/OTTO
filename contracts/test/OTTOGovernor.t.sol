// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IGovernor} from "@openzeppelin/contracts/governance/IGovernor.sol";
import {OTTOShareToken} from "../src/OTTOShareToken.sol";
import {OTTOVaultV2} from "../src/OTTOVaultV2.sol";
import {OTTOGovernor} from "../src/OTTOGovernor.sol";

contract MockUSDC_Gov is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract OTTOGovernorTest is Test {
    MockUSDC_Gov usdc;
    OTTOShareToken shareToken;
    OTTOVaultV2 vault;
    OTTOGovernor governor;

    address deployer = address(0xD0);
    address agentW   = address(0xA1);
    address alice    = address(0xA2);  // 60%
    address bob      = address(0xA3);  // 40%
    address newCeo   = address(0xC1);

    function setUp() public {
        usdc = new MockUSDC_Gov();

        // Deploy share token: alice 60%, bob 40%
        address[] memory shareholders = new address[](2);
        shareholders[0] = alice;
        shareholders[1] = bob;
        uint256[] memory bps = new uint256[](2);
        bps[0] = 6000;
        bps[1] = 4000;
        shareToken = new OTTOShareToken("OTTO Shares", "OTTOS", shareholders, bps);

        // Deploy governor
        governor = new OTTOGovernor(shareToken);

        // Deploy vault
        vm.startPrank(deployer);
        vault = new OTTOVaultV2(agentW, 10e6, 100e6, false);
        vault.initializeUsdc(address(usdc));
        vault.setShareToken(address(shareToken));
        vault.setGovernor(address(governor));
        vm.stopPrank();

        shareToken.setVault(address(vault));

        // Fund vault
        usdc.mint(address(vault), 200e6);

        // Roll forward 1 block so votes snapshot works
        vm.roll(block.number + 1);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _proposeSetCeo(address _newCeo) internal returns (uint256) {
        address[] memory targets = new address[](1);
        targets[0] = address(vault);
        uint256[] memory values = new uint256[](1);
        values[0] = 0;
        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = abi.encodeWithSelector(vault.setCeo.selector, _newCeo);

        vm.prank(alice);
        return governor.propose(targets, values, calldatas, "Replace CEO");
    }

    function _proposeDissolve() internal returns (uint256) {
        address[] memory targets = new address[](1);
        targets[0] = address(vault);
        uint256[] memory values = new uint256[](1);
        values[0] = 0;
        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = abi.encodeWithSelector(vault.dissolve.selector);

        vm.prank(alice);
        return governor.propose(targets, values, calldatas, "Dissolve treasury");
    }

    function _executeSetCeo(address _newCeo) internal {
        address[] memory targets = new address[](1);
        targets[0] = address(vault);
        uint256[] memory values = new uint256[](1);
        values[0] = 0;
        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = abi.encodeWithSelector(vault.setCeo.selector, _newCeo);

        governor.execute(targets, values, calldatas, keccak256("Replace CEO"));
    }

    function _executeDissolve() internal {
        address[] memory targets = new address[](1);
        targets[0] = address(vault);
        uint256[] memory values = new uint256[](1);
        values[0] = 0;
        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = abi.encodeWithSelector(vault.dissolve.selector);

        governor.execute(targets, values, calldatas, keccak256("Dissolve treasury"));
    }

    // ─── Tests ───────────────────────────────────────────────────────────────

    function test_AnyHolderCanPropose() public {
        uint256 proposalId = _proposeSetCeo(newCeo);
        assertTrue(proposalId != 0);
    }

    function test_VotingDelay() public view {
        assertEq(governor.votingDelay(), 1);
    }

    function test_VotingPeriod() public view {
        assertEq(governor.votingPeriod(), 100);
    }

    function test_Quorum() public view {
        // 51% of 10,000e18 = 5,100e18
        assertEq(governor.quorum(block.number - 1), 5_100e18);
    }

    function test_Execute_SetCeo_AfterSuccessfulVote() public {
        uint256 proposalId = _proposeSetCeo(newCeo);

        // Advance past voting delay
        vm.roll(block.number + governor.votingDelay() + 1);

        // Alice votes FOR (60% > 51% quorum)
        vm.prank(alice);
        governor.castVote(proposalId, 1);  // 1 = For

        // Advance past voting period
        vm.roll(block.number + governor.votingPeriod() + 1);

        // Execute
        _executeSetCeo(newCeo);

        assertEq(vault.ceo(), newCeo);
    }

    function test_Execute_Dissolve_AfterSuccessfulVote() public {
        uint256 proposalId = _proposeDissolve();

        vm.roll(block.number + governor.votingDelay() + 1);

        // Both vote for (100%)
        vm.prank(alice);
        governor.castVote(proposalId, 1);
        vm.prank(bob);
        governor.castVote(proposalId, 1);

        vm.roll(block.number + governor.votingPeriod() + 1);

        _executeDissolve();

        assertEq(uint256(vault.vaultState()), uint256(OTTOVaultV2.VaultState.Dissolving));
    }

    function test_QuorumNotReached_ProposalFails() public {
        uint256 proposalId = _proposeSetCeo(newCeo);

        vm.roll(block.number + governor.votingDelay() + 1);

        // Only bob votes (40% < 51% quorum)
        vm.prank(bob);
        governor.castVote(proposalId, 1);

        vm.roll(block.number + governor.votingPeriod() + 1);

        // Proposal should be defeated
        assertEq(uint256(governor.state(proposalId)), uint256(IGovernor.ProposalState.Defeated));
    }

    function test_VoteWeightProportionalToShares() public {
        uint256 proposalId = _proposeSetCeo(newCeo);

        vm.roll(block.number + governor.votingDelay() + 1);

        vm.prank(alice);
        governor.castVote(proposalId, 1);  // For
        vm.prank(bob);
        governor.castVote(proposalId, 0);  // Against

        vm.roll(block.number + governor.votingPeriod() + 1);

        // Alice 6000e18 for > Bob 4000e18 against → Succeeded
        assertEq(uint256(governor.state(proposalId)), uint256(IGovernor.ProposalState.Succeeded));
    }
}
