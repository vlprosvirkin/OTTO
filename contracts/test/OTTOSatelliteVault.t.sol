// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {OTTOSatelliteVault} from "../src/OTTOSatelliteVault.sol";
import {OTTOSatelliteDeployer} from "../src/deployers/OTTOSatelliteDeployer.sol";

contract MockUSDC_Sat is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract OTTOSatelliteVaultTest is Test {
    OTTOSatelliteVault vault;
    OTTOSatelliteDeployer deployer;
    MockUSDC_Sat usdc;

    address ceoAddr = address(0xC0);
    address agentAddr = address(0xA1);
    address alice = address(0xA2);
    address bob = address(0xA3);

    bytes32 salt = keccak256("satellite-test");

    function setUp() public {
        usdc = new MockUSDC_Sat();
        deployer = new OTTOSatelliteDeployer();

        vm.prank(ceoAddr);
        address v = deployer.deploy(salt, address(usdc), agentAddr, 10e6, 100e6, false);
        vault = OTTOSatelliteVault(v);
    }

    // ─── Deploy Tests ────────────────────────────────────────────────────

    function test_CeoIsDeployer() public view {
        assertEq(vault.ceo(), ceoAddr);
    }

    function test_AgentIsSet() public view {
        assertEq(vault.agent(), agentAddr);
    }

    function test_ComputeAddressMatches() public view {
        address predicted = deployer.computeAddress(
            salt, address(usdc), agentAddr, 10e6, 100e6, false
        );
        assertEq(address(vault), predicted);
    }

    // ─── Deposit ─────────────────────────────────────────────────────────

    function test_Deposit() public {
        usdc.mint(alice, 50e6);
        vm.startPrank(alice);
        usdc.approve(address(vault), 50e6);
        vault.deposit(50e6);
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(vault)), 50e6);
    }

    // ─── Agent Transfer ──────────────────────────────────────────────────

    function test_AgentTransfer() public {
        usdc.mint(address(vault), 100e6);

        vm.prank(agentAddr);
        vault.transfer(bob, 5e6);

        assertEq(usdc.balanceOf(bob), 5e6);
        assertEq(usdc.balanceOf(address(vault)), 95e6);
    }

    function test_AgentTransferExceedsPerTx() public {
        usdc.mint(address(vault), 100e6);

        vm.prank(agentAddr);
        vm.expectRevert();
        vault.transfer(bob, 15e6); // max is 10e6
    }

    function test_AgentTransferExceedsDailyLimit() public {
        usdc.mint(address(vault), 200e6);

        vm.startPrank(agentAddr);
        // Transfer 10 times = 100e6 (daily limit)
        for (uint i = 0; i < 10; i++) {
            vault.transfer(bob, 10e6);
        }
        // 11th should fail
        vm.expectRevert();
        vault.transfer(bob, 1e6);
        vm.stopPrank();
    }

    function test_DailyLimitResetsAfterDay() public {
        usdc.mint(address(vault), 200e6);

        vm.startPrank(agentAddr);
        vault.transfer(bob, 10e6);
        vm.stopPrank();

        // Advance 1 day
        vm.warp(block.timestamp + 1 days);

        vm.prank(agentAddr);
        vault.transfer(bob, 10e6); // should succeed — new day
        assertEq(usdc.balanceOf(bob), 20e6);
    }

    // ─── CEO Operations ──────────────────────────────────────────────────

    function test_CeoTransfer() public {
        usdc.mint(address(vault), 50e6);

        vm.prank(ceoAddr);
        vault.ceoTransfer(alice, 20e6);

        assertEq(usdc.balanceOf(alice), 20e6);
    }

    function test_CeoWithdraw() public {
        usdc.mint(address(vault), 50e6);

        vm.prank(ceoAddr);
        vault.withdraw(30e6);

        assertEq(usdc.balanceOf(ceoAddr), 30e6);
    }

    function test_SetLimits() public {
        vm.prank(ceoAddr);
        vault.setLimits(20e6, 200e6);

        assertEq(vault.maxPerTx(), 20e6);
        assertEq(vault.dailyLimit(), 200e6);
    }

    function test_Pause() public {
        usdc.mint(address(vault), 50e6);

        vm.prank(ceoAddr);
        vault.setPaused(true);

        vm.prank(agentAddr);
        vm.expectRevert();
        vault.transfer(bob, 1e6);

        // Unpause
        vm.prank(ceoAddr);
        vault.setPaused(false);

        vm.prank(agentAddr);
        vault.transfer(bob, 1e6);
        assertEq(usdc.balanceOf(bob), 1e6);
    }

    // ─── Whitelist ───────────────────────────────────────────────────────

    function test_WhitelistBlocksTransfer() public {
        usdc.mint(address(vault), 50e6);

        vm.startPrank(ceoAddr);
        vault.setWhitelistEnabled(true);
        vm.stopPrank();

        vm.prank(agentAddr);
        vm.expectRevert();
        vault.transfer(bob, 1e6); // bob not whitelisted

        vm.prank(ceoAddr);
        vault.setWhitelist(bob, true);

        vm.prank(agentAddr);
        vault.transfer(bob, 1e6); // now allowed
        assertEq(usdc.balanceOf(bob), 1e6);
    }

    // ─── Status View ─────────────────────────────────────────────────────

    function test_Status() public {
        usdc.mint(address(vault), 42e6);

        (
            uint256 balance,
            uint256 maxTx,
            uint256 daily,
            uint256 spent,
            uint256 remaining,
            bool wlEnabled,
            bool isPaused,
            address ag,
            address ce
        ) = vault.status();

        assertEq(balance, 42e6);
        assertEq(maxTx, 10e6);
        assertEq(daily, 100e6);
        assertEq(spent, 0);
        assertEq(remaining, 100e6);
        assertEq(wlEnabled, false);
        assertEq(isPaused, false);
        assertEq(ag, agentAddr);
        assertEq(ce, ceoAddr);
    }

    // ─── canTransfer View ────────────────────────────────────────────────

    function test_CanTransfer() public {
        usdc.mint(address(vault), 50e6);

        (bool ok, string memory reason) = vault.canTransfer(bob, 5e6);
        assertTrue(ok);
        assertEq(reason, "");

        (ok, reason) = vault.canTransfer(bob, 15e6);
        assertFalse(ok);
        assertEq(reason, "Exceeds per-tx limit");
    }

    // ─── Access Control ──────────────────────────────────────────────────

    function test_NonAgentCannotTransfer() public {
        usdc.mint(address(vault), 50e6);

        vm.prank(alice);
        vm.expectRevert();
        vault.transfer(bob, 1e6);
    }

    function test_NonCeoCannotSetLimits() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.setLimits(1e6, 1e6);
    }

    function test_TransferCeo() public {
        vm.prank(ceoAddr);
        vault.transferCeo(alice);
        assertEq(vault.ceo(), alice);
    }
}
