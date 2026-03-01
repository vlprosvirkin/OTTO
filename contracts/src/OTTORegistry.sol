// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title OTTORegistry
 * @notice On-chain registry of deployed DACs (Decentralized Autonomous Companies).
 *
 * Stores vault, share token, and governor addresses for each DAC.
 * Anyone can register a new DAC; only the CEO can update it.
 * Lookup by salt (bytes32) or by vault address.
 */
contract OTTORegistry {

    struct DAC {
        address vault;
        address shareToken;
        address governor;
        address ceo;
        uint256 createdAt;
    }

    /// @notice salt → DAC info
    mapping(bytes32 => DAC) public dacs;

    /// @notice vault address → salt (reverse lookup)
    mapping(address => bytes32) public vaultToSalt;

    /// @notice All registered salts (for enumeration)
    bytes32[] public allSalts;

    // ─── Events ──────────────────────────────────────────────────────────────

    event DACRegistered(
        bytes32 indexed salt,
        address indexed vault,
        address shareToken,
        address governor,
        address ceo
    );

    // ─── Errors ──────────────────────────────────────────────────────────────

    error SaltAlreadyUsed();
    error ZeroAddress();

    // ─── Register ────────────────────────────────────────────────────────────

    function register(
        bytes32 salt,
        address vault,
        address shareToken,
        address governor,
        address ceo
    ) external {
        if (dacs[salt].vault != address(0)) revert SaltAlreadyUsed();
        if (vault == address(0)) revert ZeroAddress();

        dacs[salt] = DAC({
            vault: vault,
            shareToken: shareToken,
            governor: governor,
            ceo: ceo,
            createdAt: block.timestamp
        });
        vaultToSalt[vault] = salt;
        allSalts.push(salt);

        emit DACRegistered(salt, vault, shareToken, governor, ceo);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    function dacCount() external view returns (uint256) {
        return allSalts.length;
    }

    function getDac(bytes32 salt) external view returns (DAC memory) {
        return dacs[salt];
    }

    function getDacByVault(address vault) external view returns (DAC memory) {
        return dacs[vaultToSalt[vault]];
    }
}
