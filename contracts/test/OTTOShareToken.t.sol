// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {OTTOShareToken} from "../src/OTTOShareToken.sol";

contract OTTOShareTokenTest is Test {
    OTTOShareToken token;

    address alice   = address(0xA1);
    address bob     = address(0xB0);
    address charlie = address(0xC1);
    address vault_  = address(0xF1);

    function setUp() public {
        address[] memory shareholders = new address[](3);
        shareholders[0] = alice;
        shareholders[1] = bob;
        shareholders[2] = charlie;

        uint256[] memory bps = new uint256[](3);
        bps[0] = 5000;  // 50%
        bps[1] = 3000;  // 30%
        bps[2] = 2000;  // 20%

        token = new OTTOShareToken("OTTO Shares", "OTTOS", shareholders, bps);
    }

    // ─── Mint Distribution ───────────────────────────────────────────────────

    function test_TotalSupply() public view {
        assertEq(token.totalSupply(), 10_000e18);
    }

    function test_MintDistribution() public view {
        assertEq(token.balanceOf(alice),   5_000e18);  // 50%
        assertEq(token.balanceOf(bob),     3_000e18);  // 30%
        assertEq(token.balanceOf(charlie), 2_000e18);  // 20%
    }

    function test_NameAndSymbol() public view {
        assertEq(token.name(),   "OTTO Shares");
        assertEq(token.symbol(), "OTTOS");
    }

    // ─── Auto-Delegation ─────────────────────────────────────────────────────

    function test_SelfDelegationOnConstruction() public view {
        assertEq(token.getVotes(alice),   5_000e18);
        assertEq(token.getVotes(bob),     3_000e18);
        assertEq(token.getVotes(charlie), 2_000e18);
    }

    function test_DelegateIsself() public view {
        assertEq(token.delegates(alice),   alice);
        assertEq(token.delegates(bob),     bob);
        assertEq(token.delegates(charlie), charlie);
    }

    // ─── Transfers ───────────────────────────────────────────────────────────

    function test_TransferMovesVotingPower() public {
        vm.prank(alice);
        token.transfer(bob, 1_000e18);

        assertEq(token.balanceOf(alice), 4_000e18);
        assertEq(token.balanceOf(bob),   4_000e18);
        assertEq(token.getVotes(alice),  4_000e18);
        assertEq(token.getVotes(bob),    4_000e18);
    }

    // ─── Freeze ──────────────────────────────────────────────────────────────

    function test_FreezeBlocksTransfers() public {
        token.setVault(vault_);

        vm.prank(vault_);
        token.freeze();

        vm.prank(alice);
        vm.expectRevert(OTTOShareToken.TokensFrozen.selector);
        token.transfer(bob, 100e18);
    }

    function test_FreezeDoesNotBlockViewFunctions() public view {
        // balanceOf works even before freeze — just verify it's accessible
        assertEq(token.balanceOf(alice), 5_000e18);
    }

    function test_OnlyVaultCanFreeze() public {
        token.setVault(vault_);

        vm.prank(alice);
        vm.expectRevert(OTTOShareToken.NotVault.selector);
        token.freeze();
    }

    function test_FrozenFlag() public {
        token.setVault(vault_);
        assertEq(token.frozen(), false);

        vm.prank(vault_);
        token.freeze();
        assertEq(token.frozen(), true);
    }

    // ─── setVault ────────────────────────────────────────────────────────────

    function test_SetVaultOnlyOnce() public {
        token.setVault(vault_);
        assertEq(token.vault(), vault_);

        vm.expectRevert(OTTOShareToken.VaultAlreadySet.selector);
        token.setVault(address(0x999));
    }

    // ─── Constructor Validation ──────────────────────────────────────────────

    function test_InvalidBpsSum_Reverts() public {
        address[] memory s = new address[](2);
        s[0] = alice;
        s[1] = bob;

        uint256[] memory bps = new uint256[](2);
        bps[0] = 5000;
        bps[1] = 4000;  // sum = 9000, not 10000

        vm.expectRevert(OTTOShareToken.SharesBpsMustSumTo10000.selector);
        new OTTOShareToken("Test", "T", s, bps);
    }

    function test_MismatchedArrays_Reverts() public {
        address[] memory s = new address[](2);
        s[0] = alice;
        s[1] = bob;

        uint256[] memory bps = new uint256[](1);
        bps[0] = 10000;

        vm.expectRevert(OTTOShareToken.InvalidShareholderData.selector);
        new OTTOShareToken("Test", "T", s, bps);
    }

    function test_EmptyShareholders_Reverts() public {
        address[] memory s = new address[](0);
        uint256[] memory bps = new uint256[](0);

        vm.expectRevert(OTTOShareToken.InvalidShareholderData.selector);
        new OTTOShareToken("Test", "T", s, bps);
    }
}
