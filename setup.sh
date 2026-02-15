#!/usr/bin/env bash
set -euo pipefail

# DeFi MCP — One-command install & build
# Usage: ./setup.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Installing dependencies..."
npm install --prefix "$SCRIPT_DIR"

echo "==> Building..."
npm run build --prefix "$SCRIPT_DIR"

DIST="$SCRIPT_DIR/dist/index.js"

echo ""
echo "==> Build complete!"
echo ""
echo "Add this MCP server to your AI tool of choice:"
echo ""
echo "--- Claude Code (.mcp.json in your project root) ---"
cat <<EOF
{
  "mcpServers": {
    "defi-mcp": {
      "command": "node",
      "args": ["$DIST"]
    }
  }
}
EOF
echo ""
echo "--- Claude Desktop (~/.claude/claude_desktop_config.json) ---"
cat <<EOF
{
  "mcpServers": {
    "defi-mcp": {
      "command": "node",
      "args": ["$DIST"]
    }
  }
}
EOF
echo ""
echo "--- Cursor (.cursor/mcp.json in your project root) ---"
cat <<EOF
{
  "mcpServers": {
    "defi-mcp": {
      "command": "node",
      "args": ["$DIST"]
    }
  }
}
EOF
echo ""
echo "--- OpenClaw / Generic MCP Client ---"
echo "Server command:  node $DIST"
echo "Transport:       stdio"
echo ""
echo "Done! Copy the config above into your client and restart it."
