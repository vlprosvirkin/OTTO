// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {OTTOShareToken} from "./OTTOShareToken.sol";

/**
 * @title OTTOVaultV2
 * @notice Governance-controlled treasury vault with shareholder ownership,
 *         revenue distribution, yield management, and dissolution.
 *
 * Roles:
 *   - CEO:       operational control (limits, whitelist, pause, revenue, yield)
 *   - Governor:  governance-only (setCeo, dissolve)
 *   - Agent:     AI agent with on-chain enforced transfer limits
 *
 * Revenue uses the Synthetix staking-rewards pattern (O(1) per claim).
 * Dissolution: Active → Dissolving → Dissolved with pro-rata claims.
 */
contract OTTOVaultV2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Lifecycle ───────────────────────────────────────────────────────────

    enum VaultState { Active, Dissolving, Dissolved }
    VaultState public vaultState;

    // ─── Core State ──────────────────────────────────────────────────────────

    IERC20 public usdc;
    bool private _usdcInitialized;

    address public ceo;
    address public governor;
    address public agent;

    OTTOShareToken public shareToken;
    bool private _shareTokenSet;
    bool private _governorSet;

    // ─── Spending Limits (same as V1) ────────────────────────────────────────

    uint256 public maxPerTx;
    uint256 public dailyLimit;
    uint256 public dailySpent;
    uint256 public dayWindowStart;
    bool public whitelistEnabled;
    mapping(address => bool) public whitelist;
    bool public paused;

    // ─── Internal Accounting ─────────────────────────────────────────────────

    uint256 public totalDeposited;
    uint256 public totalWithdrawn;
    uint256 public totalRevenueClaimed;
    uint256 public totalInvestedInYield;

    // ─── Revenue Distribution (Synthetix pattern) ────────────────────────────

    uint256 public rewardPerTokenStored;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public pendingRewards;

    // ─── Dissolution ─────────────────────────────────────────────────────────

    uint256 public dissolutionPool;
    mapping(address => bool) public dissolutionClaimed;

    // ─── Yield Strategy ──────────────────────────────────────────────────────

    IERC20 public yieldToken;
    address public yieldTeller;

    // ─── Events ──────────────────────────────────────────────────────────────

    event Deposit(address indexed from, uint256 amount);
    event AgentTransfer(address indexed to, uint256 amount, uint256 dailySpentAfter);
    event CeoTransfer(address indexed to, uint256 amount);
    event CeoWithdraw(address indexed to, uint256 amount);
    event RevenueDistributed(uint256 amount, uint256 newRewardPerToken);
    event RevenueClaimed(address indexed shareholder, uint256 amount);
    event Skimmed(address indexed to, uint256 amount);
    event DissolutionStarted();
    event DissolutionFinalized(uint256 pool);
    event DissolutionClaimed(address indexed shareholder, uint256 amount);
    event CeoUpdated(address indexed newCeo);
    event AgentUpdated(address indexed newAgent);
    event LimitsUpdated(uint256 maxPerTx, uint256 dailyLimit);
    event WhitelistUpdated(address indexed addr, bool allowed);
    event WhitelistToggled(bool enabled);
    event VaultPaused(bool paused);
    event DailyWindowReset(uint256 newWindowStart);
    event YieldStrategySet(address indexed token, address indexed teller);
    event YieldInvested(uint256 usdcAmount);
    event YieldRedeemed(uint256 usycAmount);

    // ─── Errors ──────────────────────────────────────────────────────────────

    error NotCeo();
    error NotGovernor();
    error NotAgent();
    error VaultIsPaused();
    error InvalidState(VaultState expected, VaultState actual);
    error ExceedsPerTxLimit(uint256 amount, uint256 limit);
    error ExceedsDailyLimit(uint256 amount, uint256 remaining);
    error RecipientNotWhitelisted(address recipient);
    error SenderNotWhitelisted(address sender);
    error InsufficientVaultBalance(uint256 requested, uint256 available);
    error ZeroAddress();
    error ZeroAmount();
    error UsdcAlreadyInitialized();
    error UsdcNotInitialized();
    error ShareTokenAlreadySet();
    error GovernorAlreadySet();
    error AlreadyClaimed();
    error NoYieldStrategy();
    error NothingToSkim();

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyCeo() { if (msg.sender != ceo) revert NotCeo(); _; }
    modifier onlyGovernor() { if (msg.sender != governor) revert NotGovernor(); _; }
    modifier onlyAgent() { if (msg.sender != agent) revert NotAgent(); _; }
    modifier notPaused() { if (paused) revert VaultIsPaused(); _; }
    modifier usdcReady() { if (!_usdcInitialized) revert UsdcNotInitialized(); _; }

    modifier inState(VaultState s) {
        if (vaultState != s) revert InvalidState(s, vaultState);
        _;
    }

    modifier updateReward(address account) {
        if (address(shareToken) != address(0) && shareToken.totalSupply() > 0) {
            if (account != address(0)) {
                pendingRewards[account] = pendingRevenue(account);
                userRewardPerTokenPaid[account] = rewardPerTokenStored;
            }
        }
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(
        address _agent,
        uint256 _maxPerTx,
        uint256 _dailyLimit,
        bool _whitelistEnabled
    ) {
        if (_agent == address(0)) revert ZeroAddress();
        if (_maxPerTx == 0 || _dailyLimit == 0) revert ZeroAmount();

        ceo = msg.sender;  // factory transfers to actual CEO later
        agent = _agent;
        maxPerTx = _maxPerTx;
        dailyLimit = _dailyLimit;
        whitelistEnabled = _whitelistEnabled;
        dayWindowStart = block.timestamp;
        vaultState = VaultState.Active;
    }

    // ─── Initialization (one-time, called by factory) ────────────────────────

    function initializeUsdc(address _usdc) external {
        if (_usdcInitialized) revert UsdcAlreadyInitialized();
        if (_usdc == address(0)) revert ZeroAddress();
        usdc = IERC20(_usdc);
        _usdcInitialized = true;
    }

    function setShareToken(address _token) external {
        if (_shareTokenSet) revert ShareTokenAlreadySet();
        shareToken = OTTOShareToken(_token);
        _shareTokenSet = true;
    }

    function setGovernor(address _governor) external {
        if (_governorSet) revert GovernorAlreadySet();
        governor = _governor;
        _governorSet = true;
    }

    function transferCeo(address newCeo) external onlyCeo {
        if (newCeo == address(0)) revert ZeroAddress();
        ceo = newCeo;
        emit CeoUpdated(newCeo);
    }

    // ─── Agent: Transfer (same logic as V1) ──────────────────────────────────

    function transfer(address to, uint256 amount)
        external
        onlyAgent
        notPaused
        usdcReady
        inState(VaultState.Active)
        nonReentrant
    {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        if (block.timestamp >= dayWindowStart + 1 days) {
            dailySpent = 0;
            dayWindowStart = block.timestamp;
            emit DailyWindowReset(block.timestamp);
        }

        if (amount > maxPerTx) revert ExceedsPerTxLimit(amount, maxPerTx);

        uint256 remaining = dailyLimit - dailySpent;
        if (amount > remaining) revert ExceedsDailyLimit(amount, remaining);

        if (whitelistEnabled && !whitelist[to]) revert RecipientNotWhitelisted(to);

        uint256 available = usdc.balanceOf(address(this));
        if (available < amount) revert InsufficientVaultBalance(amount, available);

        dailySpent += amount;
        totalWithdrawn += amount;
        usdc.safeTransfer(to, amount);

        emit AgentTransfer(to, amount, dailySpent);
    }

    // ─── Deposit (with whitelist on sender) ──────────────────────────────────

    function deposit(uint256 amount)
        external
        usdcReady
        inState(VaultState.Active)
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        if (whitelistEnabled && !whitelist[msg.sender]) revert SenderNotWhitelisted(msg.sender);

        usdc.safeTransferFrom(msg.sender, address(this), amount);
        totalDeposited += amount;
        emit Deposit(msg.sender, amount);
    }

    // ─── CEO: Transfers & Withdrawals ────────────────────────────────────────

    function ceoTransfer(address to, uint256 amount)
        external
        onlyCeo
        usdcReady
        inState(VaultState.Active)
        nonReentrant
    {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (whitelistEnabled && !whitelist[to]) revert RecipientNotWhitelisted(to);

        totalWithdrawn += amount;
        usdc.safeTransfer(to, amount);
        emit CeoTransfer(to, amount);
    }

    function withdraw(uint256 amount) external onlyCeo usdcReady nonReentrant {
        if (amount == 0) revert ZeroAmount();
        totalWithdrawn += amount;
        usdc.safeTransfer(ceo, amount);
        emit CeoWithdraw(ceo, amount);
    }

    // ─── CEO: Policy ─────────────────────────────────────────────────────────

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

    function setAgent(address newAgent) external onlyCeo {
        if (newAgent == address(0)) revert ZeroAddress();
        agent = newAgent;
        emit AgentUpdated(newAgent);
    }

    function setPaused(bool _paused) external onlyCeo {
        paused = _paused;
        emit VaultPaused(_paused);
    }

    // ─── CEO: Revenue Distribution ───────────────────────────────────────────

    function distributeRevenue(uint256 amount)
        external
        onlyCeo
        inState(VaultState.Active)
        updateReward(address(0))
    {
        if (amount == 0) revert ZeroAmount();

        uint256 supply = shareToken.totalSupply();
        rewardPerTokenStored += (amount * 1e18) / supply;

        emit RevenueDistributed(amount, rewardPerTokenStored);
    }

    function claimRevenue()
        external
        updateReward(msg.sender)
        nonReentrant
    {
        uint256 reward = pendingRewards[msg.sender];
        if (reward == 0) revert ZeroAmount();

        pendingRewards[msg.sender] = 0;
        totalRevenueClaimed += reward;
        usdc.safeTransfer(msg.sender, reward);

        emit RevenueClaimed(msg.sender, reward);
    }

    function pendingRevenue(address account) public view returns (uint256) {
        if (address(shareToken) == address(0)) return 0;
        uint256 supply = shareToken.totalSupply();
        if (supply == 0) return 0;

        uint256 userShare = shareToken.balanceOf(account);
        return pendingRewards[account] +
            (userShare * (rewardPerTokenStored - userRewardPerTokenPaid[account])) / 1e18;
    }

    // ─── CEO: Skim ───────────────────────────────────────────────────────────

    function skim() external onlyCeo inState(VaultState.Active) usdcReady nonReentrant {
        uint256 expected = totalDeposited - totalWithdrawn - totalRevenueClaimed;
        uint256 actual = usdc.balanceOf(address(this));
        if (actual <= expected) revert NothingToSkim();

        uint256 surplus = actual - expected;
        usdc.safeTransfer(ceo, surplus);
        emit Skimmed(ceo, surplus);
    }

    // ─── CEO: Yield Management ───────────────────────────────────────────────

    function setYieldStrategy(address _yieldToken, address _teller) external onlyCeo {
        if (_yieldToken == address(0) || _teller == address(0)) revert ZeroAddress();
        yieldToken = IERC20(_yieldToken);
        yieldTeller = _teller;
        emit YieldStrategySet(_yieldToken, _teller);
    }

    function investYield(uint256 usdcAmount)
        external
        onlyCeo
        usdcReady
        inState(VaultState.Active)
        nonReentrant
    {
        if (usdcAmount == 0) revert ZeroAmount();
        if (yieldTeller == address(0)) revert NoYieldStrategy();

        totalInvestedInYield += usdcAmount;
        usdc.forceApprove(yieldTeller, usdcAmount);

        // Call teller.buy(usdcAmount) — minimal interface
        (bool ok, ) = yieldTeller.call(abi.encodeWithSignature("buy(uint256)", usdcAmount));
        require(ok, "Yield buy failed");

        emit YieldInvested(usdcAmount);
    }

    function redeemYield(uint256 usycAmount) external onlyCeo usdcReady nonReentrant {
        // Allowed in Active and Dissolving (for consolidation before finalize)
        if (vaultState == VaultState.Dissolved) revert InvalidState(VaultState.Active, vaultState);
        if (usycAmount == 0) revert ZeroAmount();
        if (yieldTeller == address(0)) revert NoYieldStrategy();

        if (totalInvestedInYield > usycAmount) {
            totalInvestedInYield -= usycAmount;
        } else {
            totalInvestedInYield = 0;
        }

        // Approve yield token to teller for sell
        yieldToken.forceApprove(yieldTeller, usycAmount);

        (bool ok, ) = yieldTeller.call(abi.encodeWithSignature("sell(uint256)", usycAmount));
        require(ok, "Yield sell failed");

        emit YieldRedeemed(usycAmount);
    }

    function yieldBalance() external view returns (uint256) {
        if (address(yieldToken) == address(0)) return 0;
        return yieldToken.balanceOf(address(this));
    }

    // ─── Governor: CEO Management ────────────────────────────────────────────

    function setCeo(address newCeo) external onlyGovernor {
        if (newCeo == address(0)) revert ZeroAddress();
        ceo = newCeo;
        emit CeoUpdated(newCeo);
    }

    // ─── Governor: Dissolution ───────────────────────────────────────────────

    function dissolve() external onlyGovernor inState(VaultState.Active) {
        vaultState = VaultState.Dissolving;
        paused = true;
        emit DissolutionStarted();
        emit VaultPaused(true);
    }

    function finalize() external inState(VaultState.Dissolving) nonReentrant {
        dissolutionPool = usdc.balanceOf(address(this));
        vaultState = VaultState.Dissolved;
        shareToken.freeze();
        emit DissolutionFinalized(dissolutionPool);
    }

    function claimDissolution() external inState(VaultState.Dissolved) nonReentrant {
        if (dissolutionClaimed[msg.sender]) revert AlreadyClaimed();

        uint256 share = shareToken.balanceOf(msg.sender);
        if (share == 0) revert ZeroAmount();

        uint256 payout = (dissolutionPool * share) / shareToken.totalSupply();
        dissolutionClaimed[msg.sender] = true;
        usdc.safeTransfer(msg.sender, payout);

        emit DissolutionClaimed(msg.sender, payout);
    }

    // ─── View: Status ────────────────────────────────────────────────────────

    function vaultBalance() external view usdcReady returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    function remainingDailyAllowance() external view returns (uint256) {
        if (block.timestamp >= dayWindowStart + 1 days) return dailyLimit;
        return dailyLimit - dailySpent;
    }

    function canTransfer(address to, uint256 amount)
        external
        view
        usdcReady
        returns (bool ok, string memory reason)
    {
        if (vaultState != VaultState.Active) return (false, "Vault not active");
        if (paused)           return (false, "Vault is paused");
        if (amount == 0)      return (false, "Zero amount");
        if (amount > maxPerTx) return (false, "Exceeds per-tx limit");

        uint256 effectiveSpent = (block.timestamp >= dayWindowStart + 1 days) ? 0 : dailySpent;
        if (effectiveSpent + amount > dailyLimit) return (false, "Exceeds daily limit");
        if (whitelistEnabled && !whitelist[to])   return (false, "Recipient not whitelisted");
        if (usdc.balanceOf(address(this)) < amount) return (false, "Insufficient vault balance");

        return (true, "");
    }

    function status() external view usdcReady returns (
        uint256 balance_,
        uint256 maxPerTx_,
        uint256 dailyLimit_,
        uint256 dailySpent_,
        uint256 remainingToday_,
        bool    whitelistEnabled_,
        bool    paused_,
        address agent_,
        address ceo_,
        address governor_,
        VaultState state_,
        uint256 totalInvestedInYield_
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
            ceo,
            governor,
            vaultState,
            totalInvestedInYield
        );
    }
}
