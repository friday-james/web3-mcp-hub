# DeFi MCP

An MCP server that gives AI agents native access to DeFi. **10 chains, 113 tools, 43 plugins, 6 swap aggregators** — through a single [Model Context Protocol](https://modelcontextprotocol.io) server.

Connect it to Claude, Cursor, or any MCP-compatible client and interact with DeFi using natural language.

```
"Scan this wallet for all DeFi positions"
"Find me the best yield for 10,000 USDC"
"Swap 1 ETH to USDC on Arbitrum"
"Simulate this transaction before I sign it"
"Is this token safe to buy? Check for honeypots"
"Check my Aave health factor across all chains"
"Compare the cost of this swap on every chain"
"Audit my token approvals for risky contracts"
"Calculate impermanent loss on my ETH/USDC LP"
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

## Supported Chains

| Ecosystem | Chains |
|-----------|--------|
| **EVM** | Ethereum, Base, Arbitrum, Polygon, Optimism, Avalanche, BNB Chain |
| **Solana** | Solana |
| **Cosmos** | Osmosis, Cosmos Hub |

## Tools (113)

### Intelligence & Analytics

| Tool | Description |
|------|-------------|
| `defi_wallet_scan` | Scan a wallet across all protocols and chains. Returns every position with USD values. |
| `defi_find_best_yield` | Find the best yield for a token across all chains and protocols. |
| `defi_portfolio` | Portfolio overview across multiple chains with USD values. |
| `defi_trending_tokens` | Top trending tokens on CoinGecko in the last 24 hours. |
| `defi_global_market` | Global crypto market stats: total market cap, BTC/ETH dominance, 24h volume. |
| `defi_token_categories` | Token categories (DeFi, Gaming, AI, L1, etc.) with market cap and volume. |
| `defi_top_tokens` | Top cryptocurrencies by market cap with price, volume, and changes. |
| `defi_dex_search` | Search DEX trading pairs across all chains by name, symbol, or address. |
| `defi_dex_token_pairs` | All DEX trading pairs for a token with real-time price and volume. |
| `defi_dex_trending` | Trending/boosted tokens on DexScreener. |

### AI Safety & Risk

| Tool | Description |
|------|-------------|
| `defi_simulate_tx` | Dry-run a transaction to check if it will succeed or revert before signing. Reports gas cost and balance checks. |
| `defi_simulate_bundle` | Simulate a sequence of transactions (e.g. approve → swap) to verify the whole flow works. |
| `defi_protocol_risk` | Risk-score a DeFi protocol based on TVL, age, audits, chain presence, and hack history. |
| `defi_pre_trade_check` | Comprehensive pre-trade safety check: honeypot detection, tax analysis, liquidity depth, contract verification. |
| `defi_approval_audit` | Audit all active token approvals for a wallet. Flags unlimited approvals and unknown spenders. |
| `defi_health_dashboard` | Monitor all lending positions (Aave + Compound) across all chains. Alerts on liquidation risk. |
| `defi_stablecoin_monitor` | Monitor stablecoin peg health for USDT, USDC, DAI, etc. Alerts on depegging. |
| `defi_impermanent_loss` | Calculate IL for LP positions with dollar amounts, fee comparison, and scenario analysis. |
| `defi_yield_vs_hold` | Compare LP, lending, staking, and holding strategies for a given token and timeframe. |
| `defi_compare_gas` | Compare gas costs across all EVM chains to find the cheapest for an operation. |
| `defi_operation_costs` | Get gas cost estimates for all common DeFi operations on a specific chain. |

### Token & Price Data

| Tool | Description |
|------|-------------|
| `defi_get_chains` | List all supported chains with IDs, ecosystems, and native tokens. |
| `defi_token_info` | Token metadata (name, symbol, decimals, address) by symbol or contract. |
| `defi_token_price` | Live USD prices, 24h change, and market cap. |
| `defi_get_balances` | Token balances for a wallet on a specific chain. |
| `defi_token_search` | Search token contract addresses by name or symbol across chains. |
| `defi_popular_tokens` | Curated list of popular token addresses per chain (stablecoins, WETH, etc.). |
| `defi_chainlink_price` | On-chain price from a Chainlink oracle feed. |
| `defi_chainlink_prices` | All Chainlink oracle prices for a chain in one call. |

### Trading & Swaps

| Tool | Description |
|------|-------------|
| `defi_swap_quote` | Swap quote via Li.Fi, Jupiter, Skip, 0x, ParaSwap, or 1inch. |
| `defi_swap_build_tx` | Build an unsigned swap transaction ready for signing. |
| `defi_weth_wrap_tx` | Wrap native tokens (ETH→WETH, MATIC→WMATIC, AVAX→WAVAX, BNB→WBNB). |
| `defi_weth_unwrap_tx` | Unwrap wrapped native tokens back. |

### Lending — Aave V3

| Tool | Description |
|------|-------------|
| `defi_lending_markets` | All Aave V3 markets with APYs, liquidity, and utilization. |
| `defi_lending_position` | User's Aave V3 position: supplied, borrowed, health factor. |
| `defi_lending_supply_tx` | Build unsigned supply transaction. |
| `defi_lending_withdraw_tx` | Build unsigned withdraw transaction. |
| `defi_lending_borrow_tx` | Build unsigned borrow transaction. |
| `defi_lending_repay_tx` | Build unsigned repay transaction. |
| `defi_aave_reserves` | Detailed reserve data: APYs, utilization, caps, risk parameters. |
| `defi_aave_flash_loan_info` | Flash loan info: available liquidity, premium rates per asset. |
| `defi_aave_health_factor` | Health factor and liquidation risk assessment. |

### Lending — Compound V3

| Tool | Description |
|------|-------------|
| `defi_compound_markets` | Compound V3 markets with supply/borrow APY, utilization, TVL. |
| `defi_compound_position` | User's supply/borrow balance and current rates. |
| `defi_compound_supply_tx` | Build unsigned supply transaction. |
| `defi_compound_withdraw_tx` | Build unsigned withdraw transaction. |

### Lending — Morpho Blue

| Tool | Description |
|------|-------------|
| `defi_morpho_markets` | Morpho Blue lending markets with APY and TVL. |
| `defi_morpho_vaults` | Curated vault strategies with performance data. |
| `defi_morpho_positions` | User's positions across Morpho markets. |

### Liquid Staking

| Tool | Description |
|------|-------------|
| `defi_lido_stake_tx` | Stake ETH and receive stETH. |
| `defi_lido_wrap_tx` | Wrap stETH into wstETH. |
| `defi_lido_unwrap_tx` | Unwrap wstETH back to stETH. |
| `defi_rocketpool_info` | Rocket Pool stats: exchange rate, APR, TVL. |
| `defi_rocketpool_stake_tx` | Stake ETH for rETH. |
| `defi_rocketpool_unstake_tx` | Burn rETH back to ETH. |

### Yield Vaults

| Tool | Description |
|------|-------------|
| `defi_sdai_info` | sDAI (Savings Dai) stats: exchange rate, total assets. |
| `defi_sdai_deposit_tx` | Deposit DAI into sDAI. |
| `defi_sdai_withdraw_tx` | Withdraw DAI from sDAI. |
| `defi_yearn_vaults` | Yearn V3 vaults with APY and TVL. |
| `defi_yearn_deposit_tx` | Deposit into a Yearn vault. |
| `defi_yearn_withdraw_tx` | Withdraw from a Yearn vault. |

### DEX & AMM

| Tool | Description |
|------|-------------|
| `defi_uniswap_pools` | Top Uniswap V3 pools by TVL or volume. |
| `defi_uniswap_pool_info` | Detailed pool info: price, TVL, volume, tick data, 7-day history. |
| `defi_uniswap_positions` | User's Uniswap V3 LP positions with fees earned. |
| `defi_uniswap_collect_fees_tx` | Build unsigned tx to collect LP fees. |
| `defi_curve_pools` | Curve pools with APY and TVL. |
| `defi_curve_pool_info` | Detailed Curve pool info and composition. |
| `defi_balancer_pools` | Balancer pools with TVL, APR, and token composition. |

### Perpetuals (GMX)

| Tool | Description |
|------|-------------|
| `defi_gmx_markets` | GMX V2 perpetual markets with open interest and funding rates. |
| `defi_gmx_prices` | GMX oracle prices (min/max for order execution). |
| `defi_gmx_positions` | User's GMX trading history and positions. |

### Yield Trading (Pendle)

| Tool | Description |
|------|-------------|
| `defi_pendle_markets` | Pendle yield trading markets with implied/underlying APY. |
| `defi_pendle_assets` | Pendle tokenized assets (PT, YT, SY). |

### Restaking (EigenLayer)

| Tool | Description |
|------|-------------|
| `defi_eigenlayer_operators` | Top EigenLayer operators by TVL. |
| `defi_eigenlayer_staker` | Restaking positions for an address. |

### Prediction Markets (Polymarket)

| Tool | Description |
|------|-------------|
| `defi_polymarket_markets` | Active prediction markets with odds, volume, and end dates. |
| `defi_polymarket_positions` | Wallet's open positions and P&L. |
| `defi_polymarket_quote` | Current price for an outcome token. |
| `defi_polymarket_build_tx` | Build unsigned tx to split USDC into YES/NO outcome tokens. |

### Cross-chain Bridges

| Tool | Description |
|------|-------------|
| `defi_bridge_quote` | Bridge quote for moving tokens between chains via Li.Fi. |

### Protocol Analytics (DefiLlama)

| Tool | Description |
|------|-------------|
| `defi_protocols` | All protocols with TVL, category, and chain breakdown. |
| `defi_protocol_tvl` | TVL history for a specific protocol. |
| `defi_chain_tvl` | TVL for a specific chain over time. |
| `defi_stablecoins` | Stablecoin market data: market cap, peg history. |
| `defi_dex_volume` | DEX volume by chain and protocol. |
| `defi_protocol_fees` | Protocol fee and revenue data. |
| `defi_price_chart` | Token price chart data from DefiLlama. |
| `defi_historical_price` | Historical token price at a specific timestamp. |

### Governance (Snapshot)

| Tool | Description |
|------|-------------|
| `defi_snapshot_spaces` | DAO governance spaces on Snapshot. |
| `defi_snapshot_proposals` | Active/recent governance proposals for a DAO. |
| `defi_snapshot_vote_power` | Voting power for an address in a Snapshot space. |

### Multisig (Safe)

| Tool | Description |
|------|-------------|
| `defi_safe_info` | Safe multisig info: owners, threshold, nonce. |
| `defi_safe_transactions` | Pending and recent Safe transactions. |
| `defi_safe_balances` | Token balances in a Safe with USD values. |

### NFTs

| Tool | Description |
|------|-------------|
| `defi_nft_collection` | NFT collection data: floor price, market cap. |
| `defi_nft_transfer_tx` | Build unsigned ERC721 transfer transaction. |

### Security

| Tool | Description |
|------|-------------|
| `defi_token_security` | Token security audit: honeypot, proxy, mintable, tax, ownership risks. |
| `defi_address_security` | Address security check: phishing, sanctions, cybercrime flags. |

### Approvals & Permissions

| Tool | Description |
|------|-------------|
| `defi_token_approve` | Build unsigned ERC20 approve transaction. |
| `defi_check_allowance` | Check current ERC20 allowance for a spender. |
| `defi_revoke_approval_tx` | Build unsigned tx to revoke a token approval. |
| `defi_permit2_approve_tx` | Set Permit2 allowance with expiration. |
| `defi_permit2_allowance` | Check Permit2 allowance and expiration. |

### Transfers

| Tool | Description |
|------|-------------|
| `defi_transfer_tx` | Build unsigned ERC20 token transfer. |
| `defi_native_transfer_tx` | Build unsigned native token (ETH/MATIC/etc.) transfer. |

### Smart Contract Tools

| Tool | Description |
|------|-------------|
| `defi_read_contract` | Call any view/pure function on any smart contract. |
| `defi_multicall` | Batch multiple contract reads into a single RPC request. |
| `defi_contract_info` | Check if address is contract or EOA, bytecode size, balance. |

### Transaction Utilities

| Tool | Description |
|------|-------------|
| `defi_tx_status` | Transaction status, gas used, and decoded events. |
| `defi_gas_price` | Current gas prices (EVM: gwei, Solana: priority fees). |
| `defi_estimate_gas` | Estimate gas cost for an arbitrary transaction. |
| `defi_block_info` | Block info: number, timestamp, gas used, tx count. |
| `defi_get_nonce` | Current nonce and pending tx detection. |
| `defi_resolve_ens` | Resolve ENS names to addresses (and reverse). |

## Architecture

```
src/
├── core/               # Registry, types, plugin interfaces
├── chains/             # Chain adapters (EVM, Solana, Cosmos)
├── plugins/
│   ├── token-info/     # Token metadata & pricing (CoinGecko)
│   ├── coingecko/      # Market intelligence (trending, categories, top tokens)
│   ├── balances/       # Token balance lookups
│   ├── swap/           # DEX aggregators (Li.Fi, Jupiter, Skip, 0x, ParaSwap, 1inch)
│   ├── weth/           # Wrap/unwrap native tokens
│   ├── gas/            # Gas price feeds
│   ├── portfolio/      # Cross-chain portfolio
│   ├── tx-status/      # Transaction tracking
│   ├── tx-tools/       # Gas estimation, block info, nonce
│   ├── approve/        # ERC20 approvals, allowances, revoke
│   ├── permit2/        # Uniswap Permit2 allowances
│   ├── bridge/         # Cross-chain bridges (Li.Fi)
│   ├── ens/            # ENS resolution
│   ├── transfers/      # ERC20 and native token transfers
│   ├── lending/        # Aave V3 (markets, positions, tx building)
│   ├── aave-extended/  # Aave V3 flash loans, reserves, health factor
│   ├── compound-v3/    # Compound V3 (markets, positions, supply/withdraw)
│   ├── morpho/         # Morpho Blue (markets, vaults, positions)
│   ├── lido/           # Lido liquid staking (stake, wrap, unwrap)
│   ├── rocket-pool/    # Rocket Pool (stake, unstake)
│   ├── sdai/           # MakerDAO sDAI (deposit, withdraw)
│   ├── yearn/          # Yearn V3 vaults (deposit, withdraw)
│   ├── uniswap-v3/     # Uniswap V3 (pools, positions, collect fees)
│   ├── curve/          # Curve pools and analytics
│   ├── balancer/       # Balancer pools with APR
│   ├── gmx/            # GMX V2 perpetuals
│   ├── pendle/         # Pendle yield trading
│   ├── eigenlayer/     # EigenLayer restaking
│   ├── polymarket/     # Prediction markets
│   ├── defillama/      # Protocol TVL, fees, volume analytics
│   ├── dex-screener/   # DEX pair search and trending
│   ├── chainlink/      # Chainlink oracle price feeds
│   ├── snapshot/       # DAO governance
│   ├── safe/           # Gnosis Safe multisig
│   ├── nft/            # NFT collection data and transfers
│   ├── security/       # Token and address security audits
│   ├── token-lists/    # Token search and popular addresses
│   ├── contract-reader/# Generic contract reads and multicall
│   ├── simulation/     # Transaction simulation and bundle dry-runs
│   ├── risk/           # Protocol risk scoring, pre-trade checks, approval audits
│   ├── health-monitor/ # Cross-protocol lending health + stablecoin peg monitor
│   ├── il-calculator/  # Impermanent loss calculator and strategy comparison
│   ├── gas-optimizer/  # Cross-chain gas comparison and operation cost estimates
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

1. Create a plugin in `src/plugins/your-protocol/plugin.ts`
2. Export it from `src/plugins/index.ts`
3. Register it in `src/index.ts`:

```typescript
await registry.registerPlugin(new YourProtocolPlugin());
```

For wallet scanning, implement `ProtocolScanner` and register:

```typescript
registry.registerScanner(new YourProtocolScanner());
```

For yield discovery, implement `YieldSource` and register:

```typescript
registry.registerYieldSource(new YourProtocolYieldSource());
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
