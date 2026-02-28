// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";

/**
 * @title OTTOShareToken
 * @notice Governance + ownership token for OTTOVault V2 treasuries.
 *
 * Fixed supply minted at creation, distributed to shareholders by basis points.
 * Each token = 1 vote via ERC20Votes. Voting power is auto-delegated at construction.
 *
 * The linked vault can freeze all transfers (for dissolution claims).
 */
contract OTTOShareToken is ERC20, ERC20Permit, ERC20Votes {

    /// @notice Total supply: 10,000 tokens (1 basis point = 1 token)
    uint256 public constant TOTAL_SUPPLY = 10_000e18;

    /// @notice If true, all transfers are blocked (set by vault on dissolution)
    bool public frozen;

    /// @notice The vault contract that can freeze this token
    address public vault;

    // ─── Errors ──────────────────────────────────────────────────────────────

    error TokensFrozen();
    error NotVault();
    error VaultAlreadySet();
    error InvalidShareholderData();
    error SharesBpsMustSumTo10000();

    // ─── Events ──────────────────────────────────────────────────────────────

    event Frozen();
    event VaultSet(address indexed vault);

    // ─── Constructor ─────────────────────────────────────────────────────────

    /**
     * @param name_         Token name (e.g. "OTTO Treasury Shares")
     * @param symbol_       Token symbol (e.g. "OTTOS")
     * @param shareholders  Array of shareholder addresses
     * @param sharesBps     Array of shares in basis points (must sum to 10000)
     */
    constructor(
        string memory name_,
        string memory symbol_,
        address[] memory shareholders,
        uint256[] memory sharesBps
    ) ERC20(name_, symbol_) ERC20Permit(name_) {
        if (shareholders.length == 0 || shareholders.length != sharesBps.length) {
            revert InvalidShareholderData();
        }

        uint256 totalBps;
        for (uint256 i = 0; i < sharesBps.length; i++) {
            totalBps += sharesBps[i];
        }
        if (totalBps != 10_000) revert SharesBpsMustSumTo10000();

        // Mint proportional amounts and auto-delegate voting power
        for (uint256 i = 0; i < shareholders.length; i++) {
            uint256 amount = (TOTAL_SUPPLY * sharesBps[i]) / 10_000;
            _mint(shareholders[i], amount);
            _delegate(shareholders[i], shareholders[i]);
        }
    }

    // ─── Vault Integration ───────────────────────────────────────────────────

    /**
     * @notice Link this token to its vault. Can only be called once (by factory).
     */
    function setVault(address _vault) external {
        if (vault != address(0)) revert VaultAlreadySet();
        vault = _vault;
        emit VaultSet(_vault);
    }

    /**
     * @notice Freeze all transfers. Called by vault when entering Dissolved state.
     */
    function freeze() external {
        if (msg.sender != vault) revert NotVault();
        frozen = true;
        emit Frozen();
    }

    // ─── Required Overrides ──────────────────────────────────────────────────

    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Votes)
    {
        // Block transfers when frozen (minting from address(0) is never frozen)
        if (frozen && from != address(0)) revert TokensFrozen();
        super._update(from, to, value);
    }

    function nonces(address owner)
        public
        view
        override(ERC20Permit, Nonces)
        returns (uint256)
    {
        return super.nonces(owner);
    }
}
