// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, Vm, console} from "forge-std/Test.sol";
import {OTTOVault} from "../src/OTTOVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Minimal USDC mock with 6 decimals
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract OTTOVaultTest is Test {
    MockUSDC usdc;
    OTTOVault vault;

    address admin  = address(0xA0);
    address agent  = address(0xA1);
    address alice  = address(0xA2);
    address bob    = address(0xA3);
    address hacker = address(0xBEEF);

    uint256 constant MAX_PER_TX   = 10e6;   // 10 USDC
    uint256 constant DAILY_LIMIT  = 100e6;  // 100 USDC

    function setUp() public {
        usdc  = new MockUSDC();
        vm.prank(admin);
        vault = new OTTOVault(address(usdc), agent, MAX_PER_TX, DAILY_LIMIT, false);

        // Fund vault with 200 USDC
        usdc.mint(address(vault), 200e6);
    }

    // ─── Basic transfer ───────────────────────────────────────────────────────

    function test_AgentCanTransfer() public {
        vm.prank(agent);
        vault.transfer(alice, 5e6);

        assertEq(usdc.balanceOf(alice), 5e6);
        assertEq(vault.dailySpent(), 5e6);
    }

    function test_TransferEmitsEvent() public {
        vm.recordLogs();
        vm.prank(agent);
        vault.transfer(alice, 5e6);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertGt(logs.length, 0, "no logs emitted");
    }

    // ─── Per-tx limit ─────────────────────────────────────────────────────────

    function test_RejectsAbovePerTxLimit() public {
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(OTTOVault.ExceedsPerTxLimit.selector, 11e6, MAX_PER_TX)
        );
        vault.transfer(alice, 11e6);
    }

    function test_ExactPerTxLimitPasses() public {
        vm.prank(agent);
        vault.transfer(alice, MAX_PER_TX); // exact limit — should pass
        assertEq(usdc.balanceOf(alice), MAX_PER_TX);
    }

    // ─── Daily limit ──────────────────────────────────────────────────────────

    function test_RejectsWhenDailyLimitExceeded() public {
        // Spend 100 USDC in 10 transfers
        for (uint256 i = 0; i < 10; i++) {
            vm.prank(agent);
            vault.transfer(alice, 10e6);
        }
        assertEq(vault.dailySpent(), DAILY_LIMIT);

        // 11th transfer should fail
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(OTTOVault.ExceedsDailyLimit.selector, 1e6, 0)
        );
        vault.transfer(alice, 1e6);
    }

    function test_DailyLimitResetsAfter24h() public {
        // Exhaust daily limit
        for (uint256 i = 0; i < 10; i++) {
            vm.prank(agent);
            vault.transfer(alice, 10e6);
        }

        // Advance 1 day
        vm.warp(block.timestamp + 1 days);

        // Should work again
        vm.prank(agent);
        vault.transfer(alice, 5e6);
        assertEq(vault.dailySpent(), 5e6);
    }

    // ─── Whitelist ────────────────────────────────────────────────────────────

    function test_WhitelistBlocksUnknownRecipient() public {
        vm.prank(admin);
        vault.setWhitelistEnabled(true);

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(OTTOVault.RecipientNotWhitelisted.selector, alice)
        );
        vault.transfer(alice, 5e6);
    }

    function test_WhitelistedRecipientPasses() public {
        vm.startPrank(admin);
        vault.setWhitelistEnabled(true);
        vault.setWhitelist(alice, true);
        vm.stopPrank();

        vm.prank(agent);
        vault.transfer(alice, 5e6);
        assertEq(usdc.balanceOf(alice), 5e6);
    }

    // ─── Pause ────────────────────────────────────────────────────────────────

    function test_PausedVaultRejectsTransfer() public {
        vm.prank(admin);
        vault.setPaused(true);

        vm.prank(agent);
        vm.expectRevert(OTTOVault.VaultIsPaused.selector);
        vault.transfer(alice, 5e6);
    }

    function test_UnpauseRestoresAccess() public {
        vm.startPrank(admin);
        vault.setPaused(true);
        vault.setPaused(false);
        vm.stopPrank();

        vm.prank(agent);
        vault.transfer(alice, 5e6);
        assertEq(usdc.balanceOf(alice), 5e6);
    }

    // ─── Access control ───────────────────────────────────────────────────────

    function test_NonAgentCannotTransfer() public {
        vm.prank(hacker);
        vm.expectRevert(OTTOVault.NotAgent.selector);
        vault.transfer(alice, 5e6);
    }

    function test_NonAdminCannotSetLimits() public {
        vm.prank(hacker);
        vm.expectRevert(OTTOVault.NotAdmin.selector);
        vault.setLimits(999e6, 9999e6);
    }

    function test_AdminCanReplaceAgent() public {
        address newAgent = address(0xA9);

        vm.prank(admin);
        vault.setAgent(newAgent);
        assertEq(vault.agent(), newAgent);

        // Old agent is locked out
        vm.prank(agent);
        vm.expectRevert(OTTOVault.NotAgent.selector);
        vault.transfer(alice, 1e6);

        // New agent works
        vm.prank(newAgent);
        vault.transfer(alice, 1e6);
        assertEq(usdc.balanceOf(alice), 1e6);
    }

    // ─── Admin withdraw ───────────────────────────────────────────────────────

    function test_AdminCanWithdraw() public {
        uint256 before = usdc.balanceOf(admin);
        vm.prank(admin);
        vault.withdraw(50e6);
        assertEq(usdc.balanceOf(admin), before + 50e6);
    }

    function test_NonAdminCannotWithdraw() public {
        vm.prank(hacker);
        vm.expectRevert(OTTOVault.NotAdmin.selector);
        vault.withdraw(50e6);
    }

    // ─── View helpers ─────────────────────────────────────────────────────────

    function test_CanTransferPreview() public {
        (bool ok, string memory reason) = vault.canTransfer(alice, 5e6);
        assertTrue(ok);
        assertEq(reason, "");

        (bool ok2, string memory reason2) = vault.canTransfer(alice, 11e6);
        assertFalse(ok2);
        assertEq(reason2, "Exceeds per-tx limit");
    }

    function test_StatusReturnsCorrectData() public {
        (
            uint256 bal,
            uint256 maxPerTx_,
            uint256 dailyLimit_,
            uint256 dailySpent_,
            uint256 remaining,
            bool wl,
            bool p,
            address ag,
            address adm
        ) = vault.status();

        assertEq(bal,         200e6);
        assertEq(maxPerTx_,   MAX_PER_TX);
        assertEq(dailyLimit_, DAILY_LIMIT);
        assertEq(dailySpent_, 0);
        assertEq(remaining,   DAILY_LIMIT);
        assertFalse(wl);
        assertFalse(p);
        assertEq(ag,  agent);
        assertEq(adm, admin);
    }
}
