#!/usr/bin/env bash
# OTTO deploy script — called by GitHub Actions on self-hosted runner.
# Restarts the openclaw gateway with latest code.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_DIR="$REPO_DIR/agent"
MCP_DIR="$REPO_DIR/mcp"

echo "=== OTTO Deploy ==="
echo "Repo:  $REPO_DIR"
echo "Agent: $AGENT_DIR"
echo "MCP:   $MCP_DIR"
echo ""

# ── Load env ──────────────────────────────────────────────────────────────────
ENV_FILE="$AGENT_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a && source "$ENV_FILE" && set +a
  echo "✓ Loaded .env"
else
  echo "⚠ No .env found at $ENV_FILE — secrets must be in environment"
fi

# ANTHROPIC_API_KEY may come from GitHub Actions secret (not .env)
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-${CLAUDE_API_KEY:-}}"
if [[ -z "$ANTHROPIC_API_KEY" ]]; then
  echo "✗ ANTHROPIC_API_KEY not set — aborting" && exit 1
fi

# ── Restart openclaw gateway ───────────────────────────────────────────────────
echo ""
echo "→ Restarting openclaw gateway..."

# Stop existing gateway (ignore errors if not running)
npx --yes openclaw gateway stop 2>/dev/null || true

# Small pause to let port free
sleep 2

# Start gateway as background service (launchd on macOS)
npx openclaw gateway start 2>&1 || {
  # Fallback: install first, then start
  npx openclaw gateway install 2>&1
  npx openclaw gateway start 2>&1
}

echo "✓ Gateway restarted"

# ── Verify agent responds ──────────────────────────────────────────────────────
echo ""
echo "→ Smoke test: vault rebalance check..."
sleep 3  # let gateway fully start

RESULT=$(npx tsx "$AGENT_DIR/scripts/invoke.ts" rebalance_check '{"min_usdc":1}' 2>&1 | tail -5)
echo "$RESULT"

if echo "$RESULT" | grep -q '"threshold_usdc"'; then
  echo ""
  echo "✓ Agent healthy — rebalance_check responded"
else
  echo "✗ Smoke test failed" && exit 1
fi

echo ""
echo "=== Deploy complete ==="
