/**
 * Chat-Based Governance MCP Tools (Multi-DAC)
 *
 * Bridges Telegram group chat to on-chain OTTOVault V2 governance.
 * Tracks members (tgId → wallet → role → LP shares), proposals, and votes.
 * Supports multiple DACs simultaneously.
 *
 * Reuses existing V2 contract ABIs and on-chain reads.
 * Storage: ~/.otto/governance.json
 *
 * Environment variables:
 *   X402_PAYER_PRIVATE_KEY — Agent private key (for on-chain writes)
 */

import {
  createPublicClient,
  http,
  isAddress,
  getAddress,
  type Address,
} from "viem";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { arcTestnet } from "../lib/circle/gateway-sdk.js";
import { supabase } from "../lib/supabase/client.js";

// ─── ABIs (subset — only what we need for reads) ────────────────────────────

const SHARE_TOKEN_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "totalSupply",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getVotes",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const VAULT_V2_ABI = [
  {
    name: "ceo",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "agent",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "governor",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "status",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "balance_", type: "uint256" },
      { name: "maxPerTx_", type: "uint256" },
      { name: "dailyLimit_", type: "uint256" },
      { name: "dailySpent_", type: "uint256" },
      { name: "remainingToday_", type: "uint256" },
      { name: "whitelistEnabled_", type: "bool" },
      { name: "paused_", type: "bool" },
      { name: "agent_", type: "address" },
      { name: "ceo_", type: "address" },
      { name: "governor_", type: "address" },
      { name: "state_", type: "uint8" },
      { name: "totalInvestedInYield_", type: "uint256" },
    ],
  },
] as const;

const GOVERNOR_ABI = [
  {
    name: "state",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "proposalId", type: "uint256" }],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    name: "quorum",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "timepoint", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "votingDelay",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "votingPeriod",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getPublicClient() {
  return createPublicClient({ chain: arcTestnet, transport: http() });
}

function formatTokens(atomic: bigint): string {
  return (Number(atomic) / 1e18).toFixed(2);
}

function formatUsdc(atomic: bigint): string {
  return (Number(atomic) / 1_000_000).toFixed(2);
}

const PROPOSAL_STATES = [
  "Pending", "Active", "Canceled", "Defeated",
  "Succeeded", "Queued", "Expired", "Executed",
];

const VAULT_STATES = ["Active", "Dissolving", "Dissolved"];

// ─── Storage ─────────────────────────────────────────────────────────────────

const OTTO_DIR = join(process.env.HOME ?? "/tmp", ".otto");
const GOV_PATH = join(OTTO_DIR, "governance.json");

interface GovMember {
  eth_address: string;
  display_name: string;
  linked_at: string;
}

interface GovVote {
  support: number; // 0=Against, 1=For, 2=Abstain
  weight: string;
  voted_at: string;
}

interface GovProposal {
  action: string;
  description: string;
  proposer_tg_id: string;
  created_at: string;
  tx_hash?: string;
  votes: Record<string, GovVote>;
}

interface DacConfig {
  name: string;
  vault_address: string;
  governor_address: string;
  share_token_address: string;
  shareholders: string[];     // addresses that received shares at deploy
  chat_id?: string;
  invite_link?: string;
  created_at: string;
}

interface GovState {
  dacs: Record<string, DacConfig>;                       // keyed by vault_address
  members: Record<string, Record<string, GovMember>>;    // dac_id → { tg_user_id → member }
  proposals: Record<string, Record<string, GovProposal>>; // dac_id → { proposal_id → proposal }
}

// Legacy single-DAC format (for migration)
interface LegacyGovState {
  dac?: { vault_address: string; governor_address: string; share_token_address: string; chat_id?: string } | null;
  members?: Record<string, GovMember>;
  proposals?: Record<string, GovProposal>;
  // New format fields (if already migrated)
  dacs?: Record<string, DacConfig>;
}

function loadGov(): GovState {
  if (!existsSync(GOV_PATH)) return { dacs: {}, members: {}, proposals: {} };
  try {
    const raw = JSON.parse(readFileSync(GOV_PATH, "utf8")) as LegacyGovState;

    // Already in new format
    if (raw.dacs) return raw as unknown as GovState;

    // Migrate legacy single-DAC format
    if (raw.dac) {
      const id = getAddress(raw.dac.vault_address);
      const migrated: GovState = {
        dacs: {
          [id]: {
            name: "DAC",
            vault_address: id,
            governor_address: getAddress(raw.dac.governor_address),
            share_token_address: getAddress(raw.dac.share_token_address),
            shareholders: [],
            ...(raw.dac.chat_id ? { chat_id: raw.dac.chat_id } : {}),
            created_at: new Date().toISOString(),
          },
        },
        members: { [id]: raw.members ?? {} },
        proposals: { [id]: raw.proposals ?? {} },
      };
      // Save migrated format
      saveGov(migrated);
      return migrated;
    }

    return { dacs: {}, members: {}, proposals: {} };
  } catch {
    return { dacs: {}, members: {}, proposals: {} };
  }
}

function saveGov(state: GovState): void {
  mkdirSync(OTTO_DIR, { recursive: true });
  writeFileSync(GOV_PATH, JSON.stringify(state, null, 2));
}

// Sync user to Supabase otto_users table
async function syncUserRegistry(userId: string, ethAddress: string): Promise<void> {
  await supabase.from("otto_users").upsert(
    { user_id: userId, eth_address: ethAddress.toLowerCase() },
    { onConflict: "user_id" }
  );
}

/** Resolve which DAC to use. If vault_address is given, use it. Otherwise default to the only DAC. */
function resolveDac(state: GovState, vaultAddress?: string): { id: string; dac: DacConfig } {
  if (vaultAddress) {
    const id = getAddress(vaultAddress);
    const dac = state.dacs[id];
    if (!dac) throw new Error(`DAC not found for vault ${id}. Run gov_setup first.`);
    return { id, dac };
  }
  const ids = Object.keys(state.dacs);
  if (ids.length === 0) throw new Error("No DACs configured. Run gov_setup first.");
  if (ids.length > 1) throw new Error(`Multiple DACs configured. Specify vault_address: ${ids.join(", ")}`);
  return { id: ids[0], dac: state.dacs[ids[0]] };
}

/** Check governance activation gate. Returns null if active, or an error message if locked. */
function checkGovernanceGate(state: GovState, dacId: string): string | null {
  const dac = state.dacs[dacId];
  if (!dac || dac.shareholders.length === 0) return null; // no gate if shareholders not tracked

  const members = state.members[dacId] ?? {};
  const linkedAddresses = new Set(
    Object.values(members).map((m) => m.eth_address.toLowerCase())
  );

  const unlinked = dac.shareholders.filter(
    (addr) => !linkedAddresses.has(addr.toLowerCase())
  );

  if (unlinked.length > 0) {
    const linked = dac.shareholders.length - unlinked.length;
    return [
      `Governance locked: ${linked} of ${dac.shareholders.length} shareholders linked.`,
      `All shareholders must link their wallets before proposals and voting are enabled.`,
      ``,
      `Unlinked addresses:`,
      ...unlinked.map((a) => `- ${a}`),
    ].join("\n");
  }
  return null;
}

// ─── Role detection ──────────────────────────────────────────────────────────

async function detectRole(
  client: ReturnType<typeof getPublicClient>,
  vaultAddress: Address,
  userAddress: Address,
): Promise<string> {
  const ceo = (await client.readContract({
    address: vaultAddress,
    abi: VAULT_V2_ABI,
    functionName: "ceo",
  })) as Address;

  if (ceo.toLowerCase() === userAddress.toLowerCase()) return "CEO";

  try {
    const agent = (await client.readContract({
      address: vaultAddress,
      abi: VAULT_V2_ABI,
      functionName: "agent",
    })) as Address;
    if (agent.toLowerCase() === userAddress.toLowerCase()) return "Agent";
  } catch { /* agent() may not exist on some versions */ }

  return "Shareholder";
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. gov_setup — Configure DAC addresses
// ═══════════════════════════════════════════════════════════════════════════════

export interface GovSetupParams {
  vault_address: string;
  governor_address: string;
  share_token_address: string;
  name?: string;
  shareholders?: string[];
  chat_id?: string;
  invite_link?: string;
}

export async function handleGovSetup(params: GovSetupParams): Promise<string> {
  const { vault_address, governor_address, share_token_address, name, shareholders, chat_id, invite_link } = params;

  if (!vault_address?.startsWith("0x")) throw new Error("vault_address is required (0x...)");
  if (!governor_address?.startsWith("0x")) throw new Error("governor_address is required (0x...)");
  if (!share_token_address?.startsWith("0x")) throw new Error("share_token_address is required (0x...)");

  // Verify contracts exist by reading on-chain
  const client = getPublicClient();

  const ceo = (await client.readContract({
    address: vault_address as Address,
    abi: VAULT_V2_ABI,
    functionName: "ceo",
  })) as Address;

  const totalSupply = (await client.readContract({
    address: share_token_address as Address,
    abi: SHARE_TOKEN_ABI,
    functionName: "totalSupply",
  })) as bigint;

  const id = getAddress(vault_address);
  const state = loadGov();

  state.dacs[id] = {
    name: name ?? "DAC",
    vault_address: id,
    governor_address: getAddress(governor_address),
    share_token_address: getAddress(share_token_address),
    shareholders: (shareholders ?? []).map((a) => getAddress(a)),
    ...(chat_id ? { chat_id } : {}),
    ...(invite_link ? { invite_link } : {}),
    created_at: state.dacs[id]?.created_at ?? new Date().toISOString(),
  };

  // Initialize member/proposal maps if not existing
  if (!state.members[id]) state.members[id] = {};
  if (!state.proposals[id]) state.proposals[id] = {};

  saveGov(state);

  return [
    `## DAC Governance Configured`,
    ``,
    `**Name**: ${state.dacs[id].name}`,
    `**Vault**: ${state.dacs[id].vault_address}`,
    `**Governor**: ${state.dacs[id].governor_address}`,
    `**Share Token**: ${state.dacs[id].share_token_address}`,
    `**CEO**: ${ceo}`,
    `**Total Supply**: ${formatTokens(totalSupply)} tokens`,
    shareholders?.length ? `**Shareholders**: ${shareholders.length} addresses registered` : "",
    chat_id ? `**Chat ID**: ${chat_id}` : "",
    invite_link ? `**Invite Link**: ${invite_link}` : "",
    ``,
    `Ready. Members can now use \`/link\` to connect their wallets.`,
  ].filter(Boolean).join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. gov_link — Link Telegram ID to wallet
// ═══════════════════════════════════════════════════════════════════════════════

export interface GovLinkParams {
  user_id: string;
  eth_address: string;
  display_name?: string;
  vault_address?: string;
}

export async function handleGovLink(params: GovLinkParams): Promise<string> {
  const { user_id, eth_address, display_name } = params;

  if (!user_id) throw new Error("user_id is required");
  if (!eth_address || !isAddress(eth_address)) throw new Error("Valid eth_address is required (0x...)");

  const state = loadGov();
  const { id, dac } = resolveDac(state, params.vault_address);
  const client = getPublicClient();
  const addr = getAddress(eth_address);

  // Read share token balance
  const balance = (await client.readContract({
    address: dac.share_token_address as Address,
    abi: SHARE_TOKEN_ABI,
    functionName: "balanceOf",
    args: [addr],
  })) as bigint;

  const totalSupply = (await client.readContract({
    address: dac.share_token_address as Address,
    abi: SHARE_TOKEN_ABI,
    functionName: "totalSupply",
  })) as bigint;

  const votes = (await client.readContract({
    address: dac.share_token_address as Address,
    abi: SHARE_TOKEN_ABI,
    functionName: "getVotes",
    args: [addr],
  })) as bigint;

  if (balance === 0n) {
    return `Wallet ${addr} holds 0 share tokens. Only shareholders can link.`;
  }

  const role = await detectRole(client, dac.vault_address as Address, addr);
  const pct = totalSupply > 0n ? (Number(balance) / Number(totalSupply) * 100).toFixed(2) : "0.00";

  // Save
  if (!state.members[id]) state.members[id] = {};
  state.members[id][user_id] = {
    eth_address: addr,
    display_name: display_name ?? `User ${user_id}`,
    linked_at: new Date().toISOString(),
  };
  saveGov(state);
  await syncUserRegistry(user_id, addr);

  // Check governance gate status after linking
  const gate = checkGovernanceGate(state, id);

  return [
    `## Wallet Linked`,
    ``,
    `**DAC**: ${dac.name}`,
    `**Telegram ID**: ${user_id}`,
    `**Wallet**: ${addr}`,
    `**Role**: ${role}`,
    `**Shares**: ${formatTokens(balance)} (${pct}%)`,
    `**Voting Power**: ${formatTokens(votes)}`,
    ``,
    gate ? `Governance status: ${gate}` : `All shareholders linked. Governance is active!`,
  ].join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. gov_members — List all linked members
// ═══════════════════════════════════════════════════════════════════════════════

export interface GovMembersParams {
  vault_address?: string;
}

export async function handleGovMembers(params?: GovMembersParams): Promise<string> {
  const state = loadGov();
  const { id, dac } = resolveDac(state, params?.vault_address);
  const members = state.members[id] ?? {};
  const memberIds = Object.keys(members);

  if (memberIds.length === 0) {
    return "No members linked yet. Use `/link 0x...` to connect your wallet.";
  }

  const client = getPublicClient();

  const totalSupply = (await client.readContract({
    address: dac.share_token_address as Address,
    abi: SHARE_TOKEN_ABI,
    functionName: "totalSupply",
  })) as bigint;

  const lines: string[] = [
    `## ${dac.name} — Members (${memberIds.length})`,
    ``,
    `| # | Name | Role | Shares | % | Voting Power |`,
    `|---|------|------|--------|---|--------------|`,
  ];

  let idx = 0;
  for (const userId of memberIds) {
    const member = members[userId];
    const addr = member.eth_address as Address;

    const balance = (await client.readContract({
      address: dac.share_token_address as Address,
      abi: SHARE_TOKEN_ABI,
      functionName: "balanceOf",
      args: [addr],
    })) as bigint;

    const votes = (await client.readContract({
      address: dac.share_token_address as Address,
      abi: SHARE_TOKEN_ABI,
      functionName: "getVotes",
      args: [addr],
    })) as bigint;

    const role = await detectRole(client, dac.vault_address as Address, addr);
    const pct = totalSupply > 0n ? (Number(balance) / Number(totalSupply) * 100).toFixed(2) : "0.00";

    idx++;
    lines.push(
      `| ${idx} | ${member.display_name} | ${role} | ${formatTokens(balance)} | ${pct}% | ${formatTokens(votes)} |`
    );
  }

  lines.push("", `**Total Supply**: ${formatTokens(totalSupply)} tokens`);

  const gate = checkGovernanceGate(state, id);
  if (gate) lines.push("", gate);

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. gov_my_info — Show user's own governance info
// ═══════════════════════════════════════════════════════════════════════════════

export interface GovMyInfoParams {
  user_id: string;
  vault_address?: string;
}

export async function handleGovMyInfo(params: GovMyInfoParams): Promise<string> {
  const { user_id } = params;
  if (!user_id) throw new Error("user_id is required");

  const state = loadGov();
  const { id, dac } = resolveDac(state, params.vault_address);
  const members = state.members[id] ?? {};
  const member = members[user_id];

  if (!member) {
    return `User ${user_id} is not linked. Use \`/link 0x...\` to connect your wallet.`;
  }

  const client = getPublicClient();
  const addr = member.eth_address as Address;

  const balance = (await client.readContract({
    address: dac.share_token_address as Address,
    abi: SHARE_TOKEN_ABI,
    functionName: "balanceOf",
    args: [addr],
  })) as bigint;

  const totalSupply = (await client.readContract({
    address: dac.share_token_address as Address,
    abi: SHARE_TOKEN_ABI,
    functionName: "totalSupply",
  })) as bigint;

  const votes = (await client.readContract({
    address: dac.share_token_address as Address,
    abi: SHARE_TOKEN_ABI,
    functionName: "getVotes",
    args: [addr],
  })) as bigint;

  const role = await detectRole(client, dac.vault_address as Address, addr);
  const pct = totalSupply > 0n ? (Number(balance) / Number(totalSupply) * 100).toFixed(2) : "0.00";

  // Vote history
  const proposals = state.proposals[id] ?? {};
  const voteHistory: string[] = [];
  for (const [propId, proposal] of Object.entries(proposals)) {
    const v = proposal.votes[user_id];
    if (v) {
      const supportLabel = ["Against", "For", "Abstain"][v.support] ?? "?";
      voteHistory.push(`- Proposal #${propId.slice(0, 8)}... → ${supportLabel} (weight: ${v.weight})`);
    }
  }

  return [
    `## Your Governance Info`,
    ``,
    `**DAC**: ${dac.name}`,
    `**Name**: ${member.display_name}`,
    `**Wallet**: ${addr}`,
    `**Role**: ${role}`,
    `**Shares**: ${formatTokens(balance)} (${pct}%)`,
    `**Voting Power**: ${formatTokens(votes)}`,
    `**Linked**: ${member.linked_at}`,
    ``,
    voteHistory.length > 0 ? `### Vote History\n${voteHistory.join("\n")}` : "No votes cast yet.",
  ].join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. gov_propose — Create governance proposal from chat
// ═══════════════════════════════════════════════════════════════════════════════

export interface GovProposeParams {
  user_id: string;
  action: "setCeo" | "dissolve";
  description: string;
  new_ceo?: string;
  vault_address?: string;
}

export async function handleGovPropose(params: GovProposeParams): Promise<string> {
  const { user_id, action, description } = params;

  if (!user_id) throw new Error("user_id is required");
  if (!action) throw new Error("action is required (setCeo | dissolve)");
  if (!description) throw new Error("description is required");

  const state = loadGov();
  const { id, dac } = resolveDac(state, params.vault_address);

  // Check governance gate
  const gate = checkGovernanceGate(state, id);
  if (gate) return gate;

  const members = state.members[id] ?? {};
  const member = members[user_id];
  if (!member) throw new Error(`User ${user_id} is not linked. Use /link first.`);

  const client = getPublicClient();
  const addr = member.eth_address as Address;

  // Verify shares > 0
  const balance = (await client.readContract({
    address: dac.share_token_address as Address,
    abi: SHARE_TOKEN_ABI,
    functionName: "balanceOf",
    args: [addr],
  })) as bigint;

  if (balance === 0n) throw new Error("You have 0 share tokens. Cannot propose.");

  // Call existing V2 propose handler
  const { handleVaultV2Propose } = await import("./vault-v2.js");
  const result = await handleVaultV2Propose({
    vault_address: dac.vault_address,
    governor_address: dac.governor_address,
    action,
    new_ceo: params.new_ceo,
    description,
  });

  // Parse result for proposal details
  let parsed: { success?: boolean; txHash?: string } = {};
  try { parsed = JSON.parse(result); } catch { /* not JSON, use raw */ }

  if (!parsed.success) {
    return `Proposal creation failed.\n\n${result}`;
  }

  // Generate a short proposal ID from tx hash
  const propId = parsed.txHash ?? `prop_${Date.now()}`;

  // Save proposal
  if (!state.proposals[id]) state.proposals[id] = {};
  state.proposals[id][propId] = {
    action,
    description,
    proposer_tg_id: user_id,
    created_at: new Date().toISOString(),
    tx_hash: parsed.txHash,
    votes: {},
  };
  saveGov(state);

  const totalSupply = (await client.readContract({
    address: dac.share_token_address as Address,
    abi: SHARE_TOKEN_ABI,
    functionName: "totalSupply",
  })) as bigint;

  const pct = totalSupply > 0n ? (Number(balance) / Number(totalSupply) * 100).toFixed(2) : "0.00";

  return [
    `## Proposal Created`,
    ``,
    `**DAC**: ${dac.name}`,
    `**Action**: ${action}${action === "setCeo" && params.new_ceo ? ` → ${params.new_ceo}` : ""}`,
    `**Description**: ${description}`,
    `**Proposed by**: ${member.display_name} (${pct}% voting power)`,
    `**Proposal ID**: \`${propId}\``,
    `**Tx**: ${parsed.txHash ?? "pending"}`,
    ``,
    `Voting starts after 1 block delay. Reply **FOR** or **AGAINST** to vote.`,
  ].join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. gov_vote — Cast a vote on an active proposal
// ═══════════════════════════════════════════════════════════════════════════════

export interface GovVoteParams {
  user_id: string;
  proposal_id: string;
  support: number; // 0=Against, 1=For, 2=Abstain
  vault_address?: string;
}

export async function handleGovVote(params: GovVoteParams): Promise<string> {
  const { user_id, proposal_id, support } = params;

  if (!user_id) throw new Error("user_id is required");
  if (!proposal_id) throw new Error("proposal_id is required");
  if (support !== 0 && support !== 1 && support !== 2) {
    throw new Error("support must be 0 (Against), 1 (For), or 2 (Abstain)");
  }

  const state = loadGov();
  const { id, dac } = resolveDac(state, params.vault_address);

  // Check governance gate
  const gate = checkGovernanceGate(state, id);
  if (gate) return gate;

  const members = state.members[id] ?? {};
  const member = members[user_id];
  if (!member) throw new Error(`User ${user_id} is not linked. Use /link first.`);

  const proposals = state.proposals[id] ?? {};
  const proposal = proposals[proposal_id];
  if (!proposal) throw new Error(`Proposal ${proposal_id} not found.`);

  // Check if already voted
  if (proposal.votes[user_id]) {
    return `You already voted on this proposal (${["Against", "For", "Abstain"][proposal.votes[user_id].support]}).`;
  }

  const client = getPublicClient();
  const addr = member.eth_address as Address;

  // Get voting weight
  const votes = (await client.readContract({
    address: dac.share_token_address as Address,
    abi: SHARE_TOKEN_ABI,
    functionName: "getVotes",
    args: [addr],
  })) as bigint;

  if (votes === 0n) throw new Error("You have 0 voting power. Cannot vote.");

  // Call existing V2 vote handler
  const { handleVaultV2Vote } = await import("./vault-v2.js");

  const result = await handleVaultV2Vote({
    governor_address: dac.governor_address,
    proposal_id,
    support,
  });

  let parsed: { success?: boolean; txHash?: string } = {};
  try { parsed = JSON.parse(result); } catch { /* */ }

  if (!parsed.success) {
    return `Vote failed.\n\n${result}`;
  }

  // Record vote locally
  proposal.votes[user_id] = {
    support,
    weight: formatTokens(votes),
    voted_at: new Date().toISOString(),
  };
  saveGov(state);

  // Calculate running tally
  const tally = calculateTally(proposal);
  const supportLabel = ["Against", "For", "Abstain"][support];

  return [
    `## Vote Recorded`,
    ``,
    `**DAC**: ${dac.name}`,
    `**Voter**: ${member.display_name}`,
    `**Vote**: ${supportLabel}`,
    `**Weight**: ${formatTokens(votes)} tokens`,
    `**Tx**: ${parsed.txHash ?? "confirmed"}`,
    ``,
    `### Running Tally`,
    `FOR: ${tally.forPct}% | AGAINST: ${tally.againstPct}% | ABSTAIN: ${tally.abstainPct}%`,
    `Votes cast: ${tally.totalVoters} member(s)`,
  ].join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. gov_tally — Show current vote tally
// ═══════════════════════════════════════════════════════════════════════════════

export interface GovTallyParams {
  proposal_id?: string;
  vault_address?: string;
}

export async function handleGovTally(params: GovTallyParams): Promise<string> {
  const state = loadGov();
  const { id, dac } = resolveDac(state, params.vault_address);
  const proposals = state.proposals[id] ?? {};

  // If no proposal_id, find the most recent one
  let propId = params.proposal_id;
  if (!propId) {
    const entries = Object.entries(proposals);
    if (entries.length === 0) return "No proposals found.";
    entries.sort((a, b) => b[1].created_at.localeCompare(a[1].created_at));
    propId = entries[0][0];
  }

  const proposal = proposals[propId];
  if (!proposal) return `Proposal ${propId} not found.`;

  const tally = calculateTally(proposal);
  const members = state.members[id] ?? {};

  // Try to read on-chain state
  let onChainState = "Unknown";
  const client = getPublicClient();
  try {
    const stateNum = (await client.readContract({
      address: dac.governor_address as Address,
      abi: GOVERNOR_ABI,
      functionName: "state",
      args: [BigInt(propId)],
    })) as number;
    onChainState = PROPOSAL_STATES[stateNum] ?? "Unknown";
  } catch {
    onChainState = "Could not read (proposal may use tx hash as ID)";
  }

  // Who voted?
  const voterLines: string[] = [];
  for (const [userId, vote] of Object.entries(proposal.votes)) {
    const member = members[userId];
    const name = member?.display_name ?? userId;
    const supportLabel = ["Against", "For", "Abstain"][vote.support];
    voterLines.push(`- ${name}: **${supportLabel}** (${vote.weight} tokens)`);
  }

  // Who hasn't voted?
  const unvoted: string[] = [];
  for (const [userId, member] of Object.entries(members)) {
    if (!proposal.votes[userId]) {
      unvoted.push(`- ${member.display_name}`);
    }
  }

  return [
    `## Proposal Tally`,
    ``,
    `**DAC**: ${dac.name}`,
    `**Action**: ${proposal.action}`,
    `**Description**: ${proposal.description}`,
    `**Proposed by**: ${members[proposal.proposer_tg_id]?.display_name ?? proposal.proposer_tg_id}`,
    `**Created**: ${proposal.created_at}`,
    `**On-chain state**: ${onChainState}`,
    ``,
    `### Results`,
    `**FOR**: ${tally.forPct}% (${tally.forWeight} tokens)`,
    `**AGAINST**: ${tally.againstPct}% (${tally.againstWeight} tokens)`,
    `**ABSTAIN**: ${tally.abstainPct}% (${tally.abstainWeight} tokens)`,
    ``,
    `**Voters**: ${tally.totalVoters} of ${Object.keys(members).length} members`,
    ``,
    voterLines.length > 0 ? `### Votes Cast\n${voterLines.join("\n")}` : "",
    unvoted.length > 0 ? `\n### Not Yet Voted\n${unvoted.join("\n")}` : "",
  ].filter(Boolean).join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. gov_add_members — Batch-add members to a DAC
// ═══════════════════════════════════════════════════════════════════════════════

export interface GovAddMembersParams {
  vault_address?: string;
  members: Array<{ user_id: string; eth_address: string; display_name?: string }>;
}

export async function handleGovAddMembers(params: GovAddMembersParams): Promise<string> {
  const { members: memberList } = params;

  if (!memberList || memberList.length === 0) throw new Error("members array is required");

  const state = loadGov();
  const { id, dac } = resolveDac(state, params.vault_address);
  const client = getPublicClient();

  const totalSupply = (await client.readContract({
    address: dac.share_token_address as Address,
    abi: SHARE_TOKEN_ABI,
    functionName: "totalSupply",
  })) as bigint;

  if (!state.members[id]) state.members[id] = {};

  const results: string[] = [];
  let linked = 0;
  let skipped = 0;

  for (const entry of memberList) {
    if (!entry.user_id || !entry.eth_address || !isAddress(entry.eth_address)) {
      results.push(`- ${entry.user_id ?? "?"}: invalid address, skipped`);
      skipped++;
      continue;
    }

    const addr = getAddress(entry.eth_address);
    const balance = (await client.readContract({
      address: dac.share_token_address as Address,
      abi: SHARE_TOKEN_ABI,
      functionName: "balanceOf",
      args: [addr],
    })) as bigint;

    if (balance === 0n) {
      results.push(`- ${entry.display_name ?? entry.user_id}: 0 shares, skipped`);
      skipped++;
      continue;
    }

    const role = await detectRole(client, dac.vault_address as Address, addr);
    const pct = totalSupply > 0n ? (Number(balance) / Number(totalSupply) * 100).toFixed(2) : "0.00";

    state.members[id][entry.user_id] = {
      eth_address: addr,
      display_name: entry.display_name ?? `User ${entry.user_id}`,
      linked_at: new Date().toISOString(),
    };
    await syncUserRegistry(entry.user_id, addr);

    results.push(`- ${entry.display_name ?? entry.user_id}: ${role}, ${formatTokens(balance)} shares (${pct}%)`);
    linked++;
  }

  saveGov(state);

  const gate = checkGovernanceGate(state, id);

  return [
    `## Batch Member Registration`,
    ``,
    `**DAC**: ${dac.name}`,
    `**Linked**: ${linked} | **Skipped**: ${skipped}`,
    ``,
    ...results,
    ``,
    gate ?? "All shareholders linked. Governance is active!",
  ].join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// 9. gov_dacs — List all configured DACs
// ═══════════════════════════════════════════════════════════════════════════════

export async function handleGovDacs(): Promise<string> {
  const state = loadGov();
  const dacIds = Object.keys(state.dacs);

  if (dacIds.length === 0) {
    return "No DACs configured. Use `gov_setup` to create one.";
  }

  const lines: string[] = [`## Configured DACs (${dacIds.length})`, ""];

  for (const id of dacIds) {
    const dac = state.dacs[id];
    const members = state.members[id] ?? {};
    const memberCount = Object.keys(members).length;
    const gate = checkGovernanceGate(state, id);

    lines.push(
      `### ${dac.name}`,
      `**Vault**: ${dac.vault_address}`,
      `**Governor**: ${dac.governor_address}`,
      `**Share Token**: ${dac.share_token_address}`,
      `**Members**: ${memberCount}${dac.shareholders.length > 0 ? ` / ${dac.shareholders.length} shareholders` : ""}`,
      `**Governance**: ${gate ? "Locked" : "Active"}`,
      dac.invite_link ? `**Telegram**: ${dac.invite_link}` : "",
      "",
    );
  }

  return lines.filter(Boolean).join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// 10. gov_dacs_json — Return DACs as JSON (for API consumption)
// ═══════════════════════════════════════════════════════════════════════════════

export function handleGovDacsJson(): string {
  const state = loadGov();
  const dacs = Object.entries(state.dacs).map(([id, dac]) => {
    const members = state.members[id] ?? {};
    const gate = checkGovernanceGate(state, id);
    return {
      id,
      name: dac.name,
      vault_address: dac.vault_address,
      governor_address: dac.governor_address,
      share_token_address: dac.share_token_address,
      shareholders: dac.shareholders,
      invite_link: dac.invite_link ?? null,
      chat_id: dac.chat_id ?? null,
      member_count: Object.keys(members).length,
      shareholder_count: dac.shareholders.length,
      governance_active: gate === null,
      created_at: dac.created_at,
    };
  });
  return JSON.stringify({ dacs });
}

// ─── Tally calculation helper ────────────────────────────────────────────────

interface Tally {
  forWeight: string;
  againstWeight: string;
  abstainWeight: string;
  forPct: string;
  againstPct: string;
  abstainPct: string;
  totalVoters: number;
}

function calculateTally(proposal: GovProposal): Tally {
  let forW = 0;
  let againstW = 0;
  let abstainW = 0;

  for (const vote of Object.values(proposal.votes)) {
    const w = parseFloat(vote.weight);
    if (vote.support === 1) forW += w;
    else if (vote.support === 0) againstW += w;
    else abstainW += w;
  }

  const total = forW + againstW + abstainW;

  return {
    forWeight: forW.toFixed(2),
    againstWeight: againstW.toFixed(2),
    abstainWeight: abstainW.toFixed(2),
    forPct: total > 0 ? (forW / total * 100).toFixed(1) : "0.0",
    againstPct: total > 0 ? (againstW / total * 100).toFixed(1) : "0.0",
    abstainPct: total > 0 ? (abstainW / total * 100).toFixed(1) : "0.0",
    totalVoters: Object.keys(proposal.votes).length,
  };
}
