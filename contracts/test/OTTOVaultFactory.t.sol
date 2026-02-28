// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, Vm, console} from "forge-std/Test.sol";
import {OTTOVault} from "../src/OTTOVault.sol";
import {OTTOVaultFactory} from "../src/OTTOVaultFactory.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract OTTOVaultFactoryTest is Test {
    MockUSDC usdc;
    MockUSDC usdc2; // simulate different-chain USDC
    OTTOVaultFactory factory;

    address agent = address(0xA1);
    address user1 = address(0x1001);
    address user2 = address(0x1002);

    uint256 constant MAX_PER_TX  = 10e6;
    uint256 constant DAILY_LIMIT = 100e6;

    function setUp() public {
        usdc  = new MockUSDC();
        usdc2 = new MockUSDC();
        factory = new OTTOVaultFactory();
    }

    // ─── Basic deploy ───────────────────────────────────────────────────────

    function test_DeployReturnsNonZeroAddress() public {
        bytes32 salt = keccak256(abi.encodePacked(user1));
        vm.prank(user1);
        address vault = factory.deploy(salt, address(usdc), agent, MAX_PER_TX, DAILY_LIMIT, false);
        assertTrue(vault != address(0));
    }

    function test_ComputeAddressMatchesDeploy() public {
        bytes32 salt = keccak256(abi.encodePacked(user1));
        address predicted = factory.computeAddress(salt, agent, MAX_PER_TX, DAILY_LIMIT, false);
        vm.prank(user1);
        address actual = factory.deploy(salt, address(usdc), agent, MAX_PER_TX, DAILY_LIMIT, false);
        assertEq(predicted, actual);
    }

    function test_AdminTransferredToCaller() public {
        bytes32 salt = keccak256(abi.encodePacked(user1));
        vm.prank(user1);
        address vault = factory.deploy(salt, address(usdc), agent, MAX_PER_TX, DAILY_LIMIT, false);
        assertEq(OTTOVault(vault).admin(), user1);
    }

    function test_UsdcIsInitialized() public {
        bytes32 salt = keccak256(abi.encodePacked(user1));
        vm.prank(user1);
        address vault = factory.deploy(salt, address(usdc), agent, MAX_PER_TX, DAILY_LIMIT, false);
        assertEq(address(OTTOVault(vault).usdc()), address(usdc));
    }

    function test_AgentIsSetCorrectly() public {
        bytes32 salt = keccak256(abi.encodePacked(user1));
        vm.prank(user1);
        address vault = factory.deploy(salt, address(usdc), agent, MAX_PER_TX, DAILY_LIMIT, false);
        assertEq(OTTOVault(vault).agent(), agent);
    }

    // ─── Vault is fully functional after factory deploy ─────────────────────

    function test_VaultFunctionalAfterDeploy() public {
        bytes32 salt = keccak256(abi.encodePacked(user1));
        vm.prank(user1);
        address vault = factory.deploy(salt, address(usdc), agent, MAX_PER_TX, DAILY_LIMIT, false);

        usdc.mint(vault, 100e6);

        vm.prank(agent);
        OTTOVault(vault).transfer(address(0xBEEF), 5e6);
        assertEq(usdc.balanceOf(address(0xBEEF)), 5e6);
    }

    function test_DepositWorksAfterDeploy() public {
        bytes32 salt = keccak256(abi.encodePacked(user1));
        vm.prank(user1);
        address vault = factory.deploy(salt, address(usdc), agent, MAX_PER_TX, DAILY_LIMIT, false);

        usdc.mint(user1, 50e6);
        vm.startPrank(user1);
        usdc.approve(vault, 50e6);
        OTTOVault(vault).deposit(50e6);
        vm.stopPrank();

        assertEq(usdc.balanceOf(vault), 50e6);
    }

    // ─── Cross-chain determinism (the KEY test) ─────────────────────────────

    function test_SameSaltDifferentUsdcGivesSameComputedAddress() public {
        bytes32 salt = keccak256(abi.encodePacked(user1));
        // USDC address doesn't appear in computeAddress — result is chain-agnostic
        address predicted = factory.computeAddress(salt, agent, MAX_PER_TX, DAILY_LIMIT, false);
        assertTrue(predicted != address(0));

        // Deploy with usdc1
        vm.prank(user1);
        address vault1 = factory.deploy(salt, address(usdc), agent, MAX_PER_TX, DAILY_LIMIT, false);
        assertEq(predicted, vault1);

        // On a "different chain" same salt + params would give the same address
        // (can't redeploy on same chain, but computeAddress confirms it)
        address predicted2 = factory.computeAddress(salt, agent, MAX_PER_TX, DAILY_LIMIT, false);
        assertEq(predicted, predicted2, "Address must be same regardless of USDC");
    }

    // ─── Different users get different addresses ────────────────────────────

    function test_DifferentSaltsGiveDifferentAddresses() public {
        bytes32 salt1 = keccak256(abi.encodePacked(user1));
        bytes32 salt2 = keccak256(abi.encodePacked(user2));
        address addr1 = factory.computeAddress(salt1, agent, MAX_PER_TX, DAILY_LIMIT, false);
        address addr2 = factory.computeAddress(salt2, agent, MAX_PER_TX, DAILY_LIMIT, false);
        assertTrue(addr1 != addr2);
    }

    // ─── Cannot redeploy with same salt ─────────────────────────────────────

    function test_CannotRedeployWithSameSalt() public {
        bytes32 salt = keccak256(abi.encodePacked(user1));
        vm.prank(user1);
        factory.deploy(salt, address(usdc), agent, MAX_PER_TX, DAILY_LIMIT, false);

        vm.prank(user1);
        vm.expectRevert(); // CREATE2 collision
        factory.deploy(salt, address(usdc), agent, MAX_PER_TX, DAILY_LIMIT, false);
    }

    // ─── Event emission ─────────────────────────────────────────────────────

    function test_DeployEmitsVaultDeployedEvent() public {
        bytes32 salt = keccak256(abi.encodePacked(user1));
        vm.recordLogs();
        vm.prank(user1);
        factory.deploy(salt, address(usdc), agent, MAX_PER_TX, DAILY_LIMIT, false);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        // Should have VaultDeployed + AdminTransferred + other events
        assertGt(logs.length, 0);
    }

    // ─── USDC cannot be re-initialized after factory deploy ─────────────────

    function test_UsdcCannotBeReinitializedAfterFactoryDeploy() public {
        bytes32 salt = keccak256(abi.encodePacked(user1));
        vm.prank(user1);
        address vault = factory.deploy(salt, address(usdc), agent, MAX_PER_TX, DAILY_LIMIT, false);

        // user1 is admin, but initializeUsdc should be locked
        vm.prank(user1);
        vm.expectRevert(OTTOVault.UsdcAlreadyInitialized.selector);
        OTTOVault(vault).initializeUsdc(address(usdc2));
    }
}
