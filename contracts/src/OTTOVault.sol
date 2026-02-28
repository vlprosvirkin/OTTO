// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title OTTOVault
 * @notice Treasury vault for the OTTO AI agent.
 *
 * The organization deposits USDC here. The OTTO agent has a restricted
 * `agent` role and can only move funds within hard on-chain limits set
 * by the admin. No prompt, no instruction, no compromise of the AI can
 * override these limits — the contract enforces them at the EVM level.
 *
 * Security model:
 *   - Admin:  sets limits, manages whitelist, can pause, can withdraw
 *   - Agent:  can only call transfer() within limits
 *   - Per-tx cap:    single transfer cannot exceed maxPerTx
 *   - Daily cap:     cumulative daily spend cannot exceed dailyLimit
 *   - Whitelist:     optional — restrict recipients to approved addresses
 *   - Pause:         admin can halt agent operations instantly
 *
 * Deployed on Arc Testnet (chainId: 5042002)
 * USDC: 0x3600000000000000000000000000000000000000
 */
contract OTTOVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── State ────────────────────────────────────────────────────────────────

    IERC20 public usdc;
    bool private _usdcInitialized;

    address public admin;
    address public agent;

    /// @notice Maximum USDC the agent can send in a single transfer (6 decimals)
    uint256 public maxPerTx;

    /// @notice Maximum USDC the agent can send per day (resets every 24h)
    uint256 public dailyLimit;

    /// @notice USDC spent by agent in the current day window
    uint256 public dailySpent;

    /// @notice Timestamp of the start of the current day window
    uint256 public dayWindowStart;

    /// @notice If true, agent can only send to whitelisted addresses
    bool public whitelistEnabled;

    /// @notice Approved recipient addresses (used when whitelistEnabled)
    mapping(address => bool) public whitelist;

    /// @notice Emergency pause — admin can halt all agent transfers
    bool public paused;

    // ─── Events ───────────────────────────────────────────────────────────────

    event Deposit(address indexed from, uint256 amount);
    event AdminWithdraw(address indexed to, uint256 amount);
    event AgentTransfer(address indexed to, uint256 amount, uint256 dailySpentAfter);
    event LimitsUpdated(uint256 maxPerTx, uint256 dailyLimit);
    event WhitelistUpdated(address indexed addr, bool allowed);
    event WhitelistToggled(bool enabled);
    event AgentUpdated(address indexed newAgent);
    event AdminTransferred(address indexed newAdmin);
    event VaultPaused(bool paused);
    event DailyWindowReset(uint256 newWindowStart);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error NotAdmin();
    error NotAgent();
    error VaultIsPaused();
    error ExceedsPerTxLimit(uint256 amount, uint256 limit);
    error ExceedsDailyLimit(uint256 amount, uint256 remaining);
    error RecipientNotWhitelisted(address recipient);
    error InsufficientVaultBalance(uint256 requested, uint256 available);
    error ZeroAddress();
    error ZeroAmount();
    error UsdcAlreadyInitialized();
    error UsdcNotInitialized();

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    modifier notPaused() {
        if (paused) revert VaultIsPaused();
        _;
    }

    modifier usdcReady() {
        if (!_usdcInitialized) revert UsdcNotInitialized();
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    /**
     * @param _agent             OTTO agent address (Circle SCA or EOA)
     * @param _maxPerTx          Max USDC per single transfer (6 decimals, e.g. 10e6 = 10 USDC)
     * @param _dailyLimit        Max USDC per day (6 decimals)
     * @param _whitelistEnabled  Enforce recipient whitelist from the start
     */
    constructor(
        address _agent,
        uint256 _maxPerTx,
        uint256 _dailyLimit,
        bool _whitelistEnabled
    ) {
        if (_agent == address(0)) revert ZeroAddress();
        if (_maxPerTx == 0 || _dailyLimit == 0) revert ZeroAmount();

        admin = msg.sender;
        agent = _agent;
        maxPerTx = _maxPerTx;
        dailyLimit = _dailyLimit;
        whitelistEnabled = _whitelistEnabled;
        dayWindowStart = block.timestamp;
    }

    /**
     * @notice Set the USDC token address. Can only be called once, by admin.
     *         Separated from constructor to enable deterministic CREATE2
     *         deployment across chains where USDC addresses differ.
     * @param _usdc USDC token address on this chain
     */
    function initializeUsdc(address _usdc) external onlyAdmin {
        if (_usdcInitialized) revert UsdcAlreadyInitialized();
        if (_usdc == address(0)) revert ZeroAddress();
        usdc = IERC20(_usdc);
        _usdcInitialized = true;
    }

    // ─── Agent: Transfer ──────────────────────────────────────────────────────

    /**
     * @notice Transfer USDC to a recipient. Only callable by the agent.
     *         Enforces per-tx and daily limits. Rejects non-whitelisted
     *         recipients if whitelist is enabled. Cannot be bypassed.
     *
     * @param to     Recipient address
     * @param amount Amount in USDC (6 decimals)
     */
    function transfer(address to, uint256 amount)
        external
        onlyAgent
        notPaused
        usdcReady
        nonReentrant
    {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        // Reset daily window if 24h have passed
        if (block.timestamp >= dayWindowStart + 1 days) {
            dailySpent = 0;
            dayWindowStart = block.timestamp;
            emit DailyWindowReset(block.timestamp);
        }

        // Enforce per-transaction cap
        if (amount > maxPerTx) {
            revert ExceedsPerTxLimit(amount, maxPerTx);
        }

        // Enforce daily cap
        uint256 remaining = dailyLimit - dailySpent;
        if (amount > remaining) {
            revert ExceedsDailyLimit(amount, remaining);
        }

        // Enforce recipient whitelist
        if (whitelistEnabled && !whitelist[to]) {
            revert RecipientNotWhitelisted(to);
        }

        // Enforce vault has enough balance
        uint256 available = usdc.balanceOf(address(this));
        if (available < amount) {
            revert InsufficientVaultBalance(amount, available);
        }

        dailySpent += amount;
        usdc.safeTransfer(to, amount);

        emit AgentTransfer(to, amount, dailySpent);
    }

    // ─── Admin: Deposits & Withdrawals ────────────────────────────────────────

    /**
     * @notice Deposit USDC into the vault. Anyone can deposit.
     */
    function deposit(uint256 amount) external usdcReady nonReentrant {
        if (amount == 0) revert ZeroAmount();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposit(msg.sender, amount);
    }

    /**
     * @notice Emergency withdraw — admin only. Bypasses agent limits.
     */
    function withdraw(uint256 amount) external onlyAdmin usdcReady nonReentrant {
        if (amount == 0) revert ZeroAmount();
        usdc.safeTransfer(admin, amount);
        emit AdminWithdraw(admin, amount);
    }

    // ─── Admin: Policy Management ─────────────────────────────────────────────

    /**
     * @notice Update spending limits. Takes effect immediately.
     * @param _maxPerTx    New per-transaction limit (6 decimals)
     * @param _dailyLimit  New daily cumulative limit (6 decimals)
     */
    function setLimits(uint256 _maxPerTx, uint256 _dailyLimit) external onlyAdmin {
        if (_maxPerTx == 0 || _dailyLimit == 0) revert ZeroAmount();
        maxPerTx = _maxPerTx;
        dailyLimit = _dailyLimit;
        emit LimitsUpdated(_maxPerTx, _dailyLimit);
    }

    /**
     * @notice Add or remove an address from the recipient whitelist.
     */
    function setWhitelist(address addr, bool allowed) external onlyAdmin {
        if (addr == address(0)) revert ZeroAddress();
        whitelist[addr] = allowed;
        emit WhitelistUpdated(addr, allowed);
    }

    /**
     * @notice Enable or disable whitelist enforcement.
     */
    function setWhitelistEnabled(bool enabled) external onlyAdmin {
        whitelistEnabled = enabled;
        emit WhitelistToggled(enabled);
    }

    /**
     * @notice Replace the agent address. Old agent immediately loses access.
     */
    function setAgent(address newAgent) external onlyAdmin {
        if (newAgent == address(0)) revert ZeroAddress();
        agent = newAgent;
        emit AgentUpdated(newAgent);
    }

    /**
     * @notice Transfer admin role to a new address.
     */
    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        admin = newAdmin;
        emit AdminTransferred(newAdmin);
    }

    /**
     * @notice Pause or unpause agent transfers. Admin-only emergency control.
     */
    function setPaused(bool _paused) external onlyAdmin {
        paused = _paused;
        emit VaultPaused(_paused);
    }

    // ─── View: Status ─────────────────────────────────────────────────────────

    /**
     * @notice Current USDC balance held in the vault.
     */
    function vaultBalance() external view usdcReady returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    /**
     * @notice Remaining daily allowance for the agent.
     *         Automatically accounts for window reset.
     */
    function remainingDailyAllowance() external view returns (uint256) {
        if (block.timestamp >= dayWindowStart + 1 days) {
            return dailyLimit; // window would reset on next tx
        }
        return dailyLimit - dailySpent;
    }

    /**
     * @notice Preview whether a transfer would succeed.
     * @return ok      True if the transfer would go through
     * @return reason  Human-readable rejection reason if ok == false
     */
    function canTransfer(address to, uint256 amount)
        external
        view
        usdcReady
        returns (bool ok, string memory reason)
    {
        if (paused)           return (false, "Vault is paused");
        if (amount == 0)      return (false, "Zero amount");
        if (amount > maxPerTx) return (false, "Exceeds per-tx limit");

        uint256 effectiveSpent = (block.timestamp >= dayWindowStart + 1 days) ? 0 : dailySpent;
        if (effectiveSpent + amount > dailyLimit) return (false, "Exceeds daily limit");
        if (whitelistEnabled && !whitelist[to])   return (false, "Recipient not whitelisted");
        if (usdc.balanceOf(address(this)) < amount) return (false, "Insufficient vault balance");

        return (true, "");
    }

    /**
     * @notice Full vault status in one call.
     */
    function status() external view usdcReady returns (
        uint256 balance_,
        uint256 maxPerTx_,
        uint256 dailyLimit_,
        uint256 dailySpent_,
        uint256 remainingToday_,
        bool    whitelistEnabled_,
        bool    paused_,
        address agent_,
        address admin_
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
            admin
        );
    }
}
