# DeFi MCP

An MCP server that gives AI agents native access to DeFi. 10 chains, 29 tools, every major protocol — through a single [Model Context Protocol](https://modelcontextprotocol.io) server.

Connect it to Claude, Cursor, or any MCP-compatible client and interact with DeFi using natural language.

```
"Scan this wallet for all DeFi positions"
"Find me the best yield for 10,000 USDC"
"Swap 1 ETH to USDC on Arbitrum"
"What's my Aave health factor?"
```

## Quick Start

```bash
git clone https://github.com/njamez/defi-mcp.git
cd defi-mcp
./setup.sh
```

Or manually:

```bash
npm install
npm run build
```

### Connect to Your AI Tool

After building, add the MCP server config to your client. Replace `/path/to/defi-mcp` with the actual path.

#### Claude Code

Add `.mcp.json` to your project root (or run `claude mcp add defi-mcp node /path/to/defi-mcp/dist/index.js`):

```json
{
  "mcpServers": {
    "defi-mcp": {
      "command": "node",
      "args": ["/path/to/defi-mcp/dist/index.js"]
    }
  }
}
```

#### Claude Desktop

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "defi-mcp": {
      "command": "node",
      "args": ["/path/to/defi-mcp/dist/index.js"]
    }
  }
}
```

#### Cursor

Add `.cursor/mcp.json` to your project root:

```json
{
  "mcpServers": {
    "defi-mcp": {
      "command": "node",
      "args": ["/path/to/defi-mcp/dist/index.js"]
    }
  }
}
```

#### OpenClaw / Other MCP Clients

Use these settings in your MCP client configuration:

| Setting | Value |
|---------|-------|
| **Command** | `node /path/to/defi-mcp/dist/index.js` |
| **Transport** | `stdio` |
| **Protocol** | MCP (Model Context Protocol) |

### Run the Demo

```bash
npx tsx demo.ts [wallet_address]
```

Walks through the full capability set: infrastructure overview, live market data, wallet scanning, yield optimization, transaction building, and cross-chain swaps.

## Supported Chains

| Ecosystem | Chains |
|-----------|--------|
| **EVM** | Ethereum, Base, Arbitrum, Polygon, Optimism, Avalanche, BNB Chain |
| **Solana** | Solana |
| **Cosmos** | Osmosis, Cosmos Hub |

## Tools

### Intelligence

| Tool | Description |
|------|-------------|
| `defi_wallet_scan` | Scan a wallet across all protocols and chains. Returns every position (lending, LP, tokens) with USD values. |
| `defi_find_best_yield` | Find the best yield for a token across all chains. Returns net APY after gas and bridge costs, with an execution plan. |

### Trading

| Tool | Description |
|------|-------------|
| `defi_swap_quote` | Get a swap quote (price, output amount, price impact) via Li.Fi, Jupiter, Skip, 0x, or ParaSwap. |
| `defi_swap_build_tx` | Build an unsigned swap transaction ready for signing. |

### Lending (Aave V3)

| Tool | Description |
|------|-------------|
| `defi_lending_markets` | List all Aave V3 markets on a chain with APYs, liquidity, and utilization. |
| `defi_lending_position` | Get a user's Aave V3 position: supplied, borrowed, health factor, available borrows. |
| `defi_lending_supply_tx` | Build an unsigned supply transaction. |
| `defi_lending_withdraw_tx` | Build an unsigned withdraw transaction. |
| `defi_lending_borrow_tx` | Build an unsigned borrow transaction. |
| `defi_lending_repay_tx` | Build an unsigned repay transaction. |

### Lending (Compound V3)

| Tool | Description |
|------|-------------|
| `defi_compound_supply_tx` | Build an unsigned transaction to supply USDC into Compound V3. |
| `defi_compound_withdraw_tx` | Build an unsigned transaction to withdraw USDC from Compound V3. |

### Liquid Staking (Lido)

| Tool | Description |
|------|-------------|
| `defi_lido_stake_tx` | Build an unsigned transaction to stake ETH and receive stETH. |
| `defi_lido_wrap_tx` | Build an unsigned transaction to wrap stETH into wstETH. |
| `defi_lido_unwrap_tx` | Build an unsigned transaction to unwrap wstETH back to stETH. |

### Prediction Markets (Polymarket)

| Tool | Description |
|------|-------------|
| `defi_polymarket_markets` | List active prediction markets with odds, volume, and end dates. |
| `defi_polymarket_positions` | Get a wallet's open positions and P&L on Polymarket. |
| `defi_polymarket_quote` | Get the current price for an outcome token. |
| `defi_polymarket_build_tx` | Build an unsigned transaction to split USDC into YES/NO outcome tokens. |

### Cross-chain

| Tool | Description |
|------|-------------|
| `defi_bridge_quote` | Get a bridge quote for moving tokens between chains via Li.Fi. |

### Data

| Tool | Description |
|------|-------------|
| `defi_get_chains` | List all supported chains with IDs, ecosystems, and native tokens. |
| `defi_token_info` | Get token metadata (name, symbol, decimals, address) by symbol or contract address. |
| `defi_token_price` | Get live USD prices, 24h change, and market cap for tokens. |
| `defi_get_balances` | Get token balances for a wallet on a specific chain. |
| `defi_portfolio` | Get a portfolio overview across multiple chains with USD values. |
| `defi_gas_price` | Get current gas prices (EVM: gwei, Solana: priority fees). |

### Utilities

| Tool | Description |
|------|-------------|
| `defi_resolve_ens` | Resolve ENS names to addresses (and reverse). |
| `defi_token_approve` | Build an unsigned ERC20 approve transaction. |
| `defi_check_allowance` | Check current ERC20 allowance for a spender. |
| `defi_tx_status` | Check transaction status, gas used, and decoded events. |

## Architecture

```
src/
├── core/               # Registry, types, plugin interfaces
├── chains/             # Chain adapters (EVM, Solana, Cosmos)
├── plugins/
│   ├── token-info/     # Token metadata & pricing (CoinGecko)
│   ├── balances/       # Token balance lookups
│   ├── swap/           # DEX aggregators (Li.Fi, Jupiter, Skip, 0x, ParaSwap)
│   ├── gas/            # Gas price feeds
│   ├── portfolio/      # Cross-chain portfolio
│   ├── tx-status/      # Transaction tracking
│   ├── approve/        # ERC20 approvals & allowances
│   ├── bridge/         # Cross-chain bridges (Li.Fi)
│   ├── ens/            # ENS resolution
│   ├── lending/        # Aave V3 (markets, positions, tx building)
│   ├── polymarket/     # Polymarket prediction markets
│   ├── compound-v3/    # Compound V3 (supply/withdraw tx building)
│   ├── lido/           # Lido liquid staking (stake, wrap, unwrap)
│   ├── wallet-intelligence/  # Multi-protocol wallet scanning
│   │   └── scanners/         # Native, ERC20, Aave, Uniswap V3, Compound V3, Lido, Polymarket
│   └── yield-finder/         # Cross-chain yield optimization
│       └── sources/          # Aave V3, Compound V3, Lido
└── tools/              # MCP tool registration & schemas
```

### Plugin System

Every feature is a plugin that implements a simple interface:

```typescript
interface DefiPlugin {
  readonly name: string;
  readonly description: string;
  readonly version: string;

  initialize(context: PluginContext): Promise<void>;
  getTools(): ToolDefinition[];
}
```

Plugins register tools on the MCP server. The registry handles chain routing, tool validation, and dependency injection.

### Protocol Scanners

The wallet intelligence system uses a scanner registry. Each scanner implements:

```typescript
interface ProtocolScanner {
  readonly protocolName: string;
  readonly supportedChains: string[];
  scanPositions(chainId: string, wallet: string, ctx: PluginContext): Promise<ProtocolPosition[]>;
}
```

Built-in scanners: Native tokens, ERC20 tokens, Aave V3, Uniswap V3 LP, Compound V3, Lido, Polymarket.

### Yield Sources

The yield finder uses a similar pattern:

```typescript
interface YieldSource {
  readonly protocolName: string;
  readonly supportedChains: string[];
  getYieldOpportunities(token: string, ctx: PluginContext): Promise<YieldOpportunity[]>;
}
```

Built-in sources: Aave V3, Compound V3, Lido.

### Adding a Protocol

1. Implement `ProtocolScanner` and/or `YieldSource`
2. Register it in `src/index.ts`:

```typescript
registry.registerScanner(new MyProtocolScanner());
registry.registerYieldSource(new MyProtocolYieldSource());
```

The wallet scan and yield finder tools automatically discover and use new scanners/sources.

## Configuration

All configuration is optional. The server works out of the box with public RPCs.

### Environment Variables

Create a `.env` file:

```env
# Custom RPC endpoints (optional, public RPCs used by default)
RPC_ETHEREUM=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
RPC_BASE=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
RPC_ARBITRUM=https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY
RPC_POLYGON=https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY
RPC_OPTIMISM=https://opt-mainnet.g.alchemy.com/v2/YOUR_KEY
RPC_SOLANA=https://api.mainnet-beta.solana.com

# CoinGecko API key (optional, free tier works without it)
COINGECKO_API_KEY=your_key

# Default slippage tolerance in basis points (default: 50 = 0.5%)
DEFAULT_SLIPPAGE_BPS=50
```

## Security

This server **never** handles private keys or signs transactions. All transaction-building tools return unsigned transaction data that must be signed by the user's wallet.

## License

MIT
