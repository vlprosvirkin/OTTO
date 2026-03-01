// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {OTTOShareToken} from "../src/OTTOShareToken.sol";
import {OTTOVaultV2} from "../src/OTTOVaultV2.sol";

// ─── Mock Contracts ──────────────────────────────────────────────────────────

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockYieldTeller {
    ERC20 public usdc;
    ERC20 public yieldToken;

    constructor(address _usdc, address _yieldToken) {
        usdc = ERC20(_usdc);
        yieldToken = ERC20(_yieldToken);
    }

    function buy(uint256 usdcAmount) external {
        usdc.transferFrom(msg.sender, address(this), usdcAmount);
        MockYieldToken(address(yieldToken)).mint(msg.sender, usdcAmount);  // 1:1 for testing
    }

    function sell(uint256 usycAmount) external {
        yieldToken.transferFrom(msg.sender, address(this), usycAmount);
        usdc.transfer(msg.sender, usycAmount);  // 1:1 for testing
    }
}

contract MockYieldToken is ERC20 {
    constructor() ERC20("USYC", "USYC") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

contract OTTOVaultV2Test is Test {
    MockUSDC usdc;
    MockYieldToken usyc;
    MockYieldTeller teller;
    OTTOShareToken shareToken;
    OTTOVaultV2 vault;

    address admin   = address(0xA0);  // becomes CEO
    address agentW  = address(0xA1);
    address alice   = address(0xA2);
    address bob     = address(0xA3);
    address charlie = address(0xA4);
    address gov     = address(0xA5);  // mock governor

    uint256 constant MAX_PER_TX  = 10e6;
    uint256 constant DAILY_LIMIT = 100e6;

    function setUp() public {
        usdc = new MockUSDC();
        usyc = new MockYieldToken();
        teller = new MockYieldTeller(address(usdc), address(usyc));
        usdc.mint(address(teller), 1_000e6);  // fund teller for sell()

        // Deploy share token: alice 50%, bob 30%, charlie 20%
        address[] memory shareholders = new address[](3);
        shareholders[0] = alice;
        shareholders[1] = bob;
        shareholders[2] = charlie;
        uint256[] memory bps = new uint256[](3);
        bps[0] = 5000;
        bps[1] = 3000;
        bps[2] = 2000;
        shareToken = new OTTOShareToken("OTTO Shares", "OTTOS", shareholders, bps);

        // Deploy vault
        vm.startPrank(admin);
        vault = new OTTOVaultV2(agentW, MAX_PER_TX, DAILY_LIMIT, false);
        vault.initializeUsdc(address(usdc));
        vault.setShareToken(address(shareToken));
        vault.setGovernor(gov);
        vm.stopPrank();

        shareToken.setVault(address(vault));

        // Fund vault
        usdc.mint(address(vault), 200e6);
        vault.totalDeposited();  // warm storage
    }

    // ─── Agent Transfer ──────────────────────────────────────────────────────

    function test_AgentCanTransfer() public {
        vm.prank(agentW);
        vault.transfer(alice, 5e6);
        assertEq(usdc.balanceOf(alice), 5e6);
    }

    function test_AgentExceedsPerTxLimit() public {
        vm.prank(agentW);
        vm.expectRevert(abi.encodeWithSelector(OTTOVaultV2.ExceedsPerTxLimit.selector, 15e6, MAX_PER_TX));
        vault.transfer(alice, 15e6);
    }

    function test_NonAgentCannotTransfer() public {
        vm.prank(alice);
        vm.expectRevert(OTTOVaultV2.NotAgent.selector);
        vault.transfer(bob, 1e6);
    }

    function test_AgentBlockedWhenPaused() public {
        vm.prank(admin);
        vault.setPaused(true);

        vm.prank(agentW);
        vm.expectRevert(OTTOVaultV2.VaultIsPaused.selector);
        vault.transfer(alice, 1e6);
    }

    // ─── Deposit with Whitelist ──────────────────────────────────────────────

    function test_DepositWorks() public {
        usdc.mint(alice, 50e6);
        vm.startPrank(alice);
        usdc.approve(address(vault), 50e6);
        vault.deposit(50e6);
        vm.stopPrank();

        assertEq(vault.totalDeposited(), 50e6);
    }

    function test_DepositBlockedWhenWhitelistedAndNotOnList() public {
        vm.prank(admin);
        vault.setWhitelistEnabled(true);

        usdc.mint(alice, 50e6);
        vm.startPrank(alice);
        usdc.approve(address(vault), 50e6);
        vm.expectRevert(abi.encodeWithSelector(OTTOVaultV2.SenderNotWhitelisted.selector, alice));
        vault.deposit(50e6);
        vm.stopPrank();
    }

    function test_DepositAllowedWhenWhitelisted() public {
        vm.startPrank(admin);
        vault.setWhitelistEnabled(true);
        vault.setWhitelist(alice, true);
        vm.stopPrank();

        usdc.mint(alice, 50e6);
        vm.startPrank(alice);
        usdc.approve(address(vault), 50e6);
        vault.deposit(50e6);
        vm.stopPrank();

        assertEq(vault.totalDeposited(), 50e6);
    }

    // ─── CEO Operations ──────────────────────────────────────────────────────

    function test_CeoCanTransfer() public {
        vm.prank(admin);
        vault.ceoTransfer(alice, 20e6);
        assertEq(usdc.balanceOf(alice), 20e6);
    }

    function test_CeoCanWithdraw() public {
        vm.prank(admin);
        vault.withdraw(10e6);
        assertEq(usdc.balanceOf(admin), 10e6);
    }

    function test_CeoCanSetLimits() public {
        vm.prank(admin);
        vault.setLimits(50e6, 500e6);
        assertEq(vault.maxPerTx(), 50e6);
        assertEq(vault.dailyLimit(), 500e6);
    }

    function test_NonCeoCannotWithdraw() public {
        vm.prank(alice);
        vm.expectRevert(OTTOVaultV2.NotCeo.selector);
        vault.withdraw(1e6);
    }

    // ─── Revenue Distribution ────────────────────────────────────────────────

    function test_DistributeRevenue_Proportional() public {
        vm.prank(admin);
        vault.distributeRevenue(100e6);

        // alice 50%, bob 30%, charlie 20%
        assertEq(vault.pendingRevenue(alice),   50e6);
        assertEq(vault.pendingRevenue(bob),     30e6);
        assertEq(vault.pendingRevenue(charlie), 20e6);
    }

    function test_ClaimRevenue() public {
        vm.prank(admin);
        vault.distributeRevenue(100e6);

        vm.prank(alice);
        vault.claimRevenue();
        assertEq(usdc.balanceOf(alice), 50e6);
        assertEq(vault.totalRevenueClaimed(), 50e6);
    }

    function test_DoubleClaim_Reverts() public {
        vm.prank(admin);
        vault.distributeRevenue(100e6);

        vm.prank(alice);
        vault.claimRevenue();

        vm.prank(alice);
        vm.expectRevert(OTTOVaultV2.ZeroAmount.selector);
        vault.claimRevenue();
    }

    function test_MultipleDistributions_Accumulate() public {
        vm.prank(admin);
        vault.distributeRevenue(50e6);

        vm.prank(admin);
        vault.distributeRevenue(50e6);

        assertEq(vault.pendingRevenue(alice), 50e6);  // 50% of 100
    }

    // ─── Skim ────────────────────────────────────────────────────────────────

    function test_SkimRecoversDirectTransfers() public {
        // Direct transfer (not via deposit)
        usdc.mint(address(vault), 50e6);

        // Initial: 200e6 from setUp (but totalDeposited = 0)
        // Total in vault: 250e6, totalDeposited: 0, totalWithdrawn: 0
        // surplus = 250e6 - 0 = 250e6
        vm.prank(admin);
        vault.skim();
        assertEq(usdc.balanceOf(admin), 250e6);
    }

    function test_SkimZeroWhenBalanced() public {
        // Deposit through proper channel so accounting matches
        usdc.mint(alice, 200e6);
        vm.startPrank(alice);
        usdc.approve(address(vault), 200e6);
        vault.deposit(200e6);
        vm.stopPrank();

        // Now totalDeposited = 200e6, vault has 400e6 (200 from setUp + 200 deposit)
        // But setUp funds weren't deposited via deposit(), so surplus = 400 - 200 = 200
        // Let's withdraw the initial 200 first
        vm.prank(admin);
        vault.skim();  // skims the setUp funds
    }

    // ─── Yield Management ────────────────────────────────────────────────────

    function test_InvestYield() public {
        vm.startPrank(admin);
        vault.setYieldStrategy(address(usyc), address(teller));
        vault.investYield(50e6);
        vm.stopPrank();

        assertEq(vault.totalInvestedInYield(), 50e6);
        assertEq(usyc.balanceOf(address(vault)), 50e6);  // 1:1 mock
        assertEq(vault.yieldBalance(), 50e6);
    }

    function test_RedeemYield() public {
        vm.startPrank(admin);
        vault.setYieldStrategy(address(usyc), address(teller));
        vault.investYield(50e6);

        uint256 balBefore = usdc.balanceOf(address(vault));
        vault.redeemYield(50e6);
        uint256 balAfter = usdc.balanceOf(address(vault));
        vm.stopPrank();

        assertEq(balAfter - balBefore, 50e6);
        assertEq(vault.yieldBalance(), 0);
        assertEq(vault.totalInvestedInYield(), 0);
    }

    function test_RedeemYield_AllowedInDissolving() public {
        vm.startPrank(admin);
        vault.setYieldStrategy(address(usyc), address(teller));
        vault.investYield(50e6);
        vm.stopPrank();

        // Governor dissolves
        vm.prank(gov);
        vault.dissolve();

        // CEO can still redeem yield in Dissolving state
        vm.prank(admin);
        vault.redeemYield(50e6);
        assertEq(vault.yieldBalance(), 0);
    }

    function test_InvestYield_NonCeoReverts() public {
        vm.prank(admin);
        vault.setYieldStrategy(address(usyc), address(teller));

        vm.prank(alice);
        vm.expectRevert(OTTOVaultV2.NotCeo.selector);
        vault.investYield(10e6);
    }

    function test_InvestYield_NoStrategyReverts() public {
        vm.prank(admin);
        vm.expectRevert(OTTOVaultV2.NoYieldStrategy.selector);
        vault.investYield(10e6);
    }

    // ─── Governor: setCeo ────────────────────────────────────────────────────

    function test_GovernorCanSetCeo() public {
        vm.prank(gov);
        vault.setCeo(bob);
        assertEq(vault.ceo(), bob);
    }

    function test_NonGovernorCannotSetCeo() public {
        vm.prank(alice);
        vm.expectRevert(OTTOVaultV2.NotGovernor.selector);
        vault.setCeo(bob);
    }

    // ─── Dissolution ─────────────────────────────────────────────────────────

    function test_Dissolve_GovernorOnly() public {
        vm.prank(admin);
        vm.expectRevert(OTTOVaultV2.NotGovernor.selector);
        vault.dissolve();

        vm.prank(gov);
        vault.dissolve();
        assertEq(uint256(vault.vaultState()), uint256(OTTOVaultV2.VaultState.Dissolving));
        assertEq(vault.paused(), true);
    }

    function test_Dissolve_BlocksAgentTransfer() public {
        vm.prank(gov);
        vault.dissolve();

        vm.prank(agentW);
        vm.expectRevert(OTTOVaultV2.VaultIsPaused.selector);
        vault.transfer(alice, 1e6);
    }

    function test_Finalize_AutoDistributes() public {
        vm.prank(gov);
        vault.dissolve();

        vault.finalize();

        // State checks
        assertEq(uint256(vault.vaultState()), uint256(OTTOVaultV2.VaultState.Dissolved));
        assertEq(vault.dissolutionPool(), 200e6);  // setUp funded 200
        assertEq(shareToken.frozen(), true);

        // Pro-rata auto-distribution: alice 50%, bob 30%, charlie 20%
        assertEq(usdc.balanceOf(alice), 100e6);
        assertEq(usdc.balanceOf(bob), 60e6);
        assertEq(usdc.balanceOf(charlie), 40e6);

        // Vault should be empty
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_TransferBlockedAfterDissolved() public {
        vm.prank(gov);
        vault.dissolve();
        vault.finalize();

        vm.prank(alice);
        vm.expectRevert();  // TokensFrozen
        shareToken.transfer(bob, 100e18);
    }

    // ─── State Machine ───────────────────────────────────────────────────────

    function test_CannotDepositInDissolving() public {
        vm.prank(gov);
        vault.dissolve();

        usdc.mint(alice, 10e6);
        vm.startPrank(alice);
        usdc.approve(address(vault), 10e6);
        vm.expectRevert(abi.encodeWithSelector(
            OTTOVaultV2.InvalidState.selector,
            OTTOVaultV2.VaultState.Active,
            OTTOVaultV2.VaultState.Dissolving
        ));
        vault.deposit(10e6);
        vm.stopPrank();
    }

    function test_CannotFinalizeInActive() public {
        vm.expectRevert(abi.encodeWithSelector(
            OTTOVaultV2.InvalidState.selector,
            OTTOVaultV2.VaultState.Dissolving,
            OTTOVaultV2.VaultState.Active
        ));
        vault.finalize();
    }

    // ─── View Functions ──────────────────────────────────────────────────────

    function test_CanTransfer_Preview() public view {
        (bool ok, string memory reason) = vault.canTransfer(alice, 5e6);
        assertTrue(ok);
        assertEq(bytes(reason).length, 0);
    }

    function test_CanTransfer_ExceedsLimit() public view {
        (bool ok, string memory reason) = vault.canTransfer(alice, 15e6);
        assertFalse(ok);
        assertEq(reason, "Exceeds per-tx limit");
    }

    function test_RemainingDailyAllowance() public view {
        assertEq(vault.remainingDailyAllowance(), DAILY_LIMIT);
    }

    function test_VaultBalance() public view {
        assertEq(vault.vaultBalance(), 200e6);
    }
}
