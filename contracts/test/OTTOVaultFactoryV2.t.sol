// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {OTTOShareToken} from "../src/OTTOShareToken.sol";
import {OTTOVaultV2} from "../src/OTTOVaultV2.sol";
import {OTTOGovernor} from "../src/OTTOGovernor.sol";
import {OTTOVaultFactoryV2} from "../src/OTTOVaultFactoryV2.sol";

contract MockUSDC_Fac is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract OTTOVaultFactoryV2Test is Test {
    OTTOVaultFactoryV2 factory;
    MockUSDC_Fac usdc;

    address deployer = address(0xD0);
    address agentW   = address(0xA1);
    address alice    = address(0xA2);
    address bob      = address(0xA3);

    bytes32 salt = keccak256("test-vault-v2");

    address[] shareholders;
    uint256[] sharesBps;

    function setUp() public {
        factory = new OTTOVaultFactoryV2();
        usdc = new MockUSDC_Fac();

        shareholders = new address[](2);
        shareholders[0] = alice;
        shareholders[1] = bob;
        sharesBps = new uint256[](2);
        sharesBps[0] = 6000;
        sharesBps[1] = 4000;
    }

    function _deploy() internal returns (address vault, address token, address gov) {
        vm.prank(deployer);
        return factory.deploy(
            salt, address(usdc), agentW, 10e6, 100e6, false,
            shareholders, sharesBps
        );
    }

    // ─── Tests ───────────────────────────────────────────────────────────────

    function test_AtomicDeploy_ReturnsThreeAddresses() public {
        (address vault, address token, address gov) = _deploy();
        assertTrue(vault != address(0));
        assertTrue(token != address(0));
        assertTrue(gov   != address(0));
        assertTrue(vault != token);
        assertTrue(vault != gov);
        assertTrue(token != gov);
    }

    function test_ComputeAddress_MatchesDeploy() public {
        (address pVault, address pToken, address pGov) = factory.computeAddress(
            salt, agentW, 10e6, 100e6, false, shareholders, sharesBps
        );

        (address vault, address token, address gov) = _deploy();

        assertEq(vault, pVault);
        assertEq(token, pToken);
        assertEq(gov,   pGov);
    }

    function test_CeoIsDeployer() public {
        (address vault, , ) = _deploy();
        assertEq(OTTOVaultV2(vault).ceo(), deployer);
    }

    function test_UsdcIsInitialized() public {
        (address vault, , ) = _deploy();
        assertEq(address(OTTOVaultV2(vault).usdc()), address(usdc));
    }

    function test_ShareTokenLinkedToVault() public {
        (address vault, address token, ) = _deploy();
        assertEq(OTTOShareToken(token).vault(), vault);
    }

    function test_GovernorLinkedToToken() public {
        ( , address token, address gov) = _deploy();
        assertEq(address(OTTOGovernor(payable(gov)).token()), token);
    }

    function test_VaultLinkedToGovernor() public {
        (address vault, , address gov) = _deploy();
        assertEq(OTTOVaultV2(vault).governor(), gov);
    }

    function test_VotingPowerActiveAfterDeploy() public {
        ( , address token, ) = _deploy();
        // alice 60%, bob 40% of 10,000e18
        assertEq(OTTOShareToken(token).getVotes(alice), 6_000e18);
        assertEq(OTTOShareToken(token).getVotes(bob),   4_000e18);
    }

    function test_CannotRedeployWithSameSalt() public {
        _deploy();

        vm.prank(deployer);
        vm.expectRevert();  // CREATE2 collision
        factory.deploy(
            salt, address(usdc), agentW, 10e6, 100e6, false,
            shareholders, sharesBps
        );
    }
}
