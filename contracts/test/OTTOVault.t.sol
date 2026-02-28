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
        vm.startPrank(admin);
        vault = new OTTOVault(agent, MAX_PER_TX, DAILY_LIMIT, false);
        vault.initializeUsdc(address(usdc));
        vm.stopPrank();

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

    function test_StatusDailySpentIsZeroAfterWindowExpires() public {
        vm.prank(agent);
        vault.transfer(alice, 10e6);
        assertEq(vault.dailySpent(), 10e6);

        vm.warp(block.timestamp + 1 days);

        (, , , uint256 dailySpent_, uint256 remaining, , , ,) = vault.status();
        assertEq(dailySpent_, 0,           "dailySpent should be 0 after window expires");
        assertEq(remaining,   DAILY_LIMIT, "remaining should be full daily limit");
    }

    // ─── Deposit ──────────────────────────────────────────────────────────────

    function test_AnyoneCanDeposit() public {
        usdc.mint(alice, 50e6);
        vm.startPrank(alice);
        usdc.approve(address(vault), 50e6);
        vault.deposit(50e6);
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(vault)), 250e6); // 200 initial + 50
    }

    function test_DepositEmitsEvent() public {
        usdc.mint(alice, 10e6);
        vm.startPrank(alice);
        usdc.approve(address(vault), 10e6);
        vm.recordLogs();
        vault.deposit(10e6);
        vm.stopPrank();

        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertGt(logs.length, 0, "Deposit event not emitted");
    }

    function test_DepositZeroReverts() public {
        vm.prank(alice);
        vm.expectRevert(OTTOVault.ZeroAmount.selector);
        vault.deposit(0);
    }

    // ─── transferAdmin ────────────────────────────────────────────────────────

    function test_AdminCanTransferAdmin() public {
        address newAdmin = address(0xAB);
        vm.prank(admin);
        vault.transferAdmin(newAdmin);
        assertEq(vault.admin(), newAdmin);
    }

    function test_TransferAdminEmitsEvent() public {
        address newAdmin = address(0xAB);
        vm.recordLogs();
        vm.prank(admin);
        vault.transferAdmin(newAdmin);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertGt(logs.length, 0);
    }

    function test_OldAdminLosesAccessAfterTransfer() public {
        address newAdmin = address(0xAB);
        vm.prank(admin);
        vault.transferAdmin(newAdmin);

        vm.prank(admin);
        vm.expectRevert(OTTOVault.NotAdmin.selector);
        vault.setLimits(20e6, 200e6);
    }

    function test_NewAdminGainsAccessAfterTransfer() public {
        address newAdmin = address(0xAB);
        vm.prank(admin);
        vault.transferAdmin(newAdmin);

        vm.prank(newAdmin);
        vault.setLimits(20e6, 200e6);
        assertEq(vault.maxPerTx(), 20e6);
    }

    function test_TransferAdminToZeroReverts() public {
        vm.prank(admin);
        vm.expectRevert(OTTOVault.ZeroAddress.selector);
        vault.transferAdmin(address(0));
    }

    function test_NonAdminCannotTransferAdmin() public {
        vm.prank(hacker);
        vm.expectRevert(OTTOVault.NotAdmin.selector);
        vault.transferAdmin(hacker);
    }

    // ─── setLimits ────────────────────────────────────────────────────────────

    function test_AdminCanSetLimits() public {
        vm.prank(admin);
        vault.setLimits(50e6, 500e6);
        assertEq(vault.maxPerTx(),   50e6);
        assertEq(vault.dailyLimit(), 500e6);
    }

    function test_SetLimitsZeroMaxPerTxReverts() public {
        vm.prank(admin);
        vm.expectRevert(OTTOVault.ZeroAmount.selector);
        vault.setLimits(0, 100e6);
    }

    function test_SetLimitsZeroDailyLimitReverts() public {
        vm.prank(admin);
        vm.expectRevert(OTTOVault.ZeroAmount.selector);
        vault.setLimits(10e6, 0);
    }

    function test_NewLimitsTakeEffectImmediately() public {
        vm.prank(admin);
        vault.setLimits(1e6, 5e6); // tighten to 1 USDC/tx

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(OTTOVault.ExceedsPerTxLimit.selector, 5e6, 1e6)
        );
        vault.transfer(alice, 5e6);
    }

    // ─── canTransfer — edge cases ────────────────────────────────────────────

    function test_CanTransferReturnsFalseWhenPaused() public {
        vm.prank(admin);
        vault.setPaused(true);

        (bool ok, string memory reason) = vault.canTransfer(alice, 5e6);
        assertFalse(ok);
        assertEq(reason, "Vault is paused");
    }

    function test_CanTransferReturnsFalseWhenWhitelistBlocks() public {
        vm.prank(admin);
        vault.setWhitelistEnabled(true);

        (bool ok, string memory reason) = vault.canTransfer(alice, 5e6);
        assertFalse(ok);
        assertEq(reason, "Recipient not whitelisted");
    }

    function test_CanTransferReturnsFalseWhenInsufficientBalance() public {
        vm.prank(admin);
        vault.withdraw(200e6); // drain vault

        (bool ok, string memory reason) = vault.canTransfer(alice, 1e6);
        assertFalse(ok);
        assertEq(reason, "Insufficient vault balance");
    }

    function test_CanTransferReturnsFalseWhenDailyLimitWouldExceed() public {
        for (uint256 i = 0; i < 9; i++) {
            vm.prank(agent);
            vault.transfer(alice, 10e6);
        }
        vm.prank(agent);
        vault.transfer(alice, 5e6); // 95 spent, 5 remaining

        (bool ok, string memory reason) = vault.canTransfer(alice, 6e6);
        assertFalse(ok);
        assertEq(reason, "Exceeds daily limit");
    }

    function test_CanTransferAccountsForWindowReset() public {
        for (uint256 i = 0; i < 10; i++) {
            vm.prank(agent);
            vault.transfer(alice, 10e6);
        }
        (bool ok1,) = vault.canTransfer(alice, 1e6);
        assertFalse(ok1, "should be blocked after daily limit exhausted");

        vm.warp(block.timestamp + 1 days);

        (bool ok2,) = vault.canTransfer(alice, 10e6);
        assertTrue(ok2, "should be allowed after window resets");
    }

    // ─── Constructor validation ───────────────────────────────────────────────

    function test_ConstructorRejectsZeroAgentAddress() public {
        vm.expectRevert(OTTOVault.ZeroAddress.selector);
        new OTTOVault(address(0), MAX_PER_TX, DAILY_LIMIT, false);
    }

    function test_ConstructorRejectsZeroMaxPerTx() public {
        vm.expectRevert(OTTOVault.ZeroAmount.selector);
        new OTTOVault(agent, 0, DAILY_LIMIT, false);
    }

    function test_ConstructorRejectsZeroDailyLimit() public {
        vm.expectRevert(OTTOVault.ZeroAmount.selector);
        new OTTOVault(agent, MAX_PER_TX, 0, false);
    }

    function test_ConstructorSetsAdminToDeployer() public {
        address deployer = address(0xDE);
        vm.startPrank(deployer);
        OTTOVault v = new OTTOVault(agent, MAX_PER_TX, DAILY_LIMIT, false);
        v.initializeUsdc(address(usdc));
        vm.stopPrank();
        assertEq(v.admin(), deployer);
    }

    // ─── initializeUsdc ─────────────────────────────────────────────────────

    function test_InitializeUsdcSetsAddress() public {
        vm.startPrank(admin);
        OTTOVault v = new OTTOVault(agent, MAX_PER_TX, DAILY_LIMIT, false);
        v.initializeUsdc(address(usdc));
        vm.stopPrank();
        assertEq(address(v.usdc()), address(usdc));
    }

    function test_InitializeUsdcCannotBeCalledTwice() public {
        vm.startPrank(admin);
        OTTOVault v = new OTTOVault(agent, MAX_PER_TX, DAILY_LIMIT, false);
        v.initializeUsdc(address(usdc));
        vm.expectRevert(OTTOVault.UsdcAlreadyInitialized.selector);
        v.initializeUsdc(address(usdc));
        vm.stopPrank();
    }

    function test_OnlyAdminCanInitializeUsdc() public {
        vm.prank(admin);
        OTTOVault v = new OTTOVault(agent, MAX_PER_TX, DAILY_LIMIT, false);
        vm.prank(hacker);
        vm.expectRevert(OTTOVault.NotAdmin.selector);
        v.initializeUsdc(address(usdc));
    }

    function test_InitializeUsdcRejectsZeroAddress() public {
        vm.startPrank(admin);
        OTTOVault v = new OTTOVault(agent, MAX_PER_TX, DAILY_LIMIT, false);
        vm.expectRevert(OTTOVault.ZeroAddress.selector);
        v.initializeUsdc(address(0));
        vm.stopPrank();
    }

    function test_TransferRevertsBeforeUsdcInit() public {
        vm.prank(admin);
        OTTOVault v = new OTTOVault(agent, MAX_PER_TX, DAILY_LIMIT, false);
        vm.prank(agent);
        vm.expectRevert(OTTOVault.UsdcNotInitialized.selector);
        v.transfer(alice, 5e6);
    }

    function test_DepositRevertsBeforeUsdcInit() public {
        vm.prank(admin);
        OTTOVault v = new OTTOVault(agent, MAX_PER_TX, DAILY_LIMIT, false);
        vm.prank(alice);
        vm.expectRevert(OTTOVault.UsdcNotInitialized.selector);
        v.deposit(5e6);
    }

    // ─── Fuzz ─────────────────────────────────────────────────────────────────

    function testFuzz_TransferWithinLimitsAlwaysSucceeds(uint256 amount) public {
        amount = bound(amount, 1, MAX_PER_TX);
        usdc.mint(address(vault), amount);

        vm.prank(agent);
        vault.transfer(alice, amount);
        assertGe(usdc.balanceOf(alice), amount);
    }

    function testFuzz_TransferAbovePerTxAlwaysReverts(uint256 amount) public {
        amount = bound(amount, MAX_PER_TX + 1, type(uint128).max);

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(OTTOVault.ExceedsPerTxLimit.selector, amount, MAX_PER_TX)
        );
        vault.transfer(alice, amount);
    }

    // ─── Admin Send (adminTransfer) ─────────────────────────────────────────

    function test_AdminCanSendToAnyAddress() public {
        vm.prank(admin);
        vault.adminTransfer(alice, 25e6);
        assertEq(usdc.balanceOf(alice), 25e6);
    }

    function test_AdminSendEmitsEvent() public {
        vm.recordLogs();
        vm.prank(admin);
        vault.adminTransfer(alice, 10e6);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertGt(logs.length, 0);
    }

    function test_AdminSendRejectsZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(OTTOVault.ZeroAddress.selector);
        vault.adminTransfer(address(0), 5e6);
    }

    function test_AdminSendRejectsZeroAmount() public {
        vm.prank(admin);
        vm.expectRevert(OTTOVault.ZeroAmount.selector);
        vault.adminTransfer(alice, 0);
    }

    function test_NonAdminCannotAdminTransfer() public {
        vm.prank(hacker);
        vm.expectRevert(OTTOVault.NotAdmin.selector);
        vault.adminTransfer(alice, 5e6);
    }

    function test_AdminSendBypassesAgentLimits() public {
        // Admin can send more than maxPerTx (10 USDC)
        vm.prank(admin);
        vault.adminTransfer(alice, 50e6);
        assertEq(usdc.balanceOf(alice), 50e6);
    }

    function test_AdminSendRespectsWhitelist() public {
        vm.startPrank(admin);
        vault.setWhitelistEnabled(true);

        // alice is NOT whitelisted — should revert
        vm.expectRevert(abi.encodeWithSelector(OTTOVault.RecipientNotWhitelisted.selector, alice));
        vault.adminTransfer(alice, 5e6);
        vm.stopPrank();
    }

    function test_AdminSendToWhitelistedAddress() public {
        vm.startPrank(admin);
        vault.setWhitelistEnabled(true);
        vault.setWhitelist(alice, true);
        vault.adminTransfer(alice, 5e6);
        vm.stopPrank();
        assertEq(usdc.balanceOf(alice), 5e6);
    }

    function test_AdminSendNoWhitelistCheckWhenDisabled() public {
        // whitelist disabled (default) — should work for any address
        vm.prank(admin);
        vault.adminTransfer(bob, 15e6);
        assertEq(usdc.balanceOf(bob), 15e6);
    }

    function test_AdminSendDoesNotAffectDailySpent() public {
        vm.prank(admin);
        vault.adminTransfer(alice, 50e6);
        // dailySpent should remain 0 — only agent transfers count
        assertEq(vault.dailySpent(), 0);
    }
}
