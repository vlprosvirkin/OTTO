// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title OTTOSatelliteVault
 * @notice Lightweight vault for satellite chains (Base, Avalanche, etc.).
 *         Holds USDC and lets the OTTO agent transfer within enforced limits.
 *         No governance, no revenue distribution, no yield, no dissolution.
 *
 * Used for cross-chain liquidity via Circle CCTP — the agent moves USDC
 * between the home-chain V2 vault and satellite vaults as needed.
 */
contract OTTOSatelliteVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    address public ceo;
    address public agent;

    uint256 public maxPerTx;
    uint256 public dailyLimit;
    uint256 public dailySpent;
    uint256 public dayWindowStart;
    bool public whitelistEnabled;
    mapping(address => bool) public whitelist;
    bool public paused;

    // ─── Events ──────────────────────────────────────────────────────────

    event Deposit(address indexed from, uint256 amount);
    event AgentTransfer(address indexed to, uint256 amount, uint256 dailySpentAfter);
    event CeoTransfer(address indexed to, uint256 amount);
    event CeoWithdraw(address indexed to, uint256 amount);
    event CeoUpdated(address indexed newCeo);
    event AgentUpdated(address indexed newAgent);
    event LimitsUpdated(uint256 maxPerTx, uint256 dailyLimit);
    event WhitelistUpdated(address indexed addr, bool allowed);
    event WhitelistToggled(bool enabled);
    event VaultPaused(bool paused);

    // ─── Errors ──────────────────────────────────────────────────────────

    error NotCeo();
    error NotAgent();
    error VaultIsPaused();
    error ExceedsPerTxLimit(uint256 amount, uint256 limit);
    error ExceedsDailyLimit(uint256 amount, uint256 remaining);
    error RecipientNotWhitelisted(address recipient);
    error SenderNotWhitelisted(address sender);
    error InsufficientBalance(uint256 requested, uint256 available);
    error ZeroAddress();
    error ZeroAmount();

    // ─── Modifiers ───────────────────────────────────────────────────────

    modifier onlyCeo() { if (msg.sender != ceo) revert NotCeo(); _; }
    modifier onlyAgent() { if (msg.sender != agent) revert NotAgent(); _; }
    modifier notPaused() { if (paused) revert VaultIsPaused(); _; }

    // ─── Constructor ─────────────────────────────────────────────────────

    constructor(
        address _usdc,
        address _agent,
        uint256 _maxPerTx,
        uint256 _dailyLimit,
        bool _whitelistEnabled
    ) {
        if (_usdc == address(0) || _agent == address(0)) revert ZeroAddress();
        if (_maxPerTx == 0 || _dailyLimit == 0) revert ZeroAmount();

        usdc = IERC20(_usdc);
        ceo = msg.sender;
        agent = _agent;
        maxPerTx = _maxPerTx;
        dailyLimit = _dailyLimit;
        whitelistEnabled = _whitelistEnabled;
        dayWindowStart = block.timestamp;
    }

    // ─── Agent: Transfer ─────────────────────────────────────────────────

    function transfer(address to, uint256 amount)
        external onlyAgent notPaused nonReentrant
    {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        if (block.timestamp >= dayWindowStart + 1 days) {
            dailySpent = 0;
            dayWindowStart = block.timestamp;
        }

        if (amount > maxPerTx) revert ExceedsPerTxLimit(amount, maxPerTx);
        uint256 remaining = dailyLimit - dailySpent;
        if (amount > remaining) revert ExceedsDailyLimit(amount, remaining);
        if (whitelistEnabled && !whitelist[to]) revert RecipientNotWhitelisted(to);

        uint256 bal = usdc.balanceOf(address(this));
        if (bal < amount) revert InsufficientBalance(amount, bal);

        dailySpent += amount;
        usdc.safeTransfer(to, amount);
        emit AgentTransfer(to, amount, dailySpent);
    }

    // ─── Deposit ─────────────────────────────────────────────────────────

    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (whitelistEnabled && !whitelist[msg.sender]) revert SenderNotWhitelisted(msg.sender);
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposit(msg.sender, amount);
    }

    // ─── CEO: Transfers ──────────────────────────────────────────────────

    function ceoTransfer(address to, uint256 amount) external onlyCeo nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        usdc.safeTransfer(to, amount);
        emit CeoTransfer(to, amount);
    }

    function withdraw(uint256 amount) external onlyCeo nonReentrant {
        if (amount == 0) revert ZeroAmount();
        usdc.safeTransfer(ceo, amount);
        emit CeoWithdraw(ceo, amount);
    }

    // ─── CEO: Policy ─────────────────────────────────────────────────────

    function transferCeo(address newCeo) external onlyCeo {
        if (newCeo == address(0)) revert ZeroAddress();
        ceo = newCeo;
        emit CeoUpdated(newCeo);
    }

    function setAgent(address newAgent) external onlyCeo {
        if (newAgent == address(0)) revert ZeroAddress();
        agent = newAgent;
        emit AgentUpdated(newAgent);
    }

    function setLimits(uint256 _maxPerTx, uint256 _dailyLimit) external onlyCeo {
        if (_maxPerTx == 0 || _dailyLimit == 0) revert ZeroAmount();
        maxPerTx = _maxPerTx;
        dailyLimit = _dailyLimit;
        emit LimitsUpdated(_maxPerTx, _dailyLimit);
    }

    function setWhitelist(address addr, bool allowed) external onlyCeo {
        if (addr == address(0)) revert ZeroAddress();
        whitelist[addr] = allowed;
        emit WhitelistUpdated(addr, allowed);
    }

    function setWhitelistEnabled(bool enabled) external onlyCeo {
        whitelistEnabled = enabled;
        emit WhitelistToggled(enabled);
    }

    function setPaused(bool _paused) external onlyCeo {
        paused = _paused;
        emit VaultPaused(_paused);
    }

    // ─── Views ───────────────────────────────────────────────────────────

    function canTransfer(address to, uint256 amount)
        external view returns (bool ok, string memory reason)
    {
        if (paused)           return (false, "Vault is paused");
        if (amount == 0)      return (false, "Zero amount");
        if (amount > maxPerTx) return (false, "Exceeds per-tx limit");

        uint256 effectiveSpent = (block.timestamp >= dayWindowStart + 1 days) ? 0 : dailySpent;
        if (effectiveSpent + amount > dailyLimit) return (false, "Exceeds daily limit");
        if (whitelistEnabled && !whitelist[to])   return (false, "Recipient not whitelisted");
        if (usdc.balanceOf(address(this)) < amount) return (false, "Insufficient balance");

        return (true, "");
    }

    function status() external view returns (
        uint256 balance_,
        uint256 maxPerTx_,
        uint256 dailyLimit_,
        uint256 dailySpent_,
        uint256 remainingToday_,
        bool    whitelistEnabled_,
        bool    paused_,
        address agent_,
        address ceo_
    ) {
        bool windowExpired = block.timestamp >= dayWindowStart + 1 days;
        return (
            usdc.balanceOf(address(this)),
            maxPerTx,
            dailyLimit,
            windowExpired ? 0 : dailySpent,
            windowExpired ? dailyLimit : dailyLimit - dailySpent,
            whitelistEnabled,
            paused,
            agent,
            ceo
        );
    }
}
