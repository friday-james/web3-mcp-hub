import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { Registry } from "./core/registry.js";
import {
  EvmChainAdapter,
  EVM_CHAINS,
  SolanaChainAdapter,
  SOLANA_CHAINS,
  CosmosChainAdapter,
  COSMOS_CHAINS,
} from "./chains/index.js";
import {
  TokenInfoPlugin,
  BalancesPlugin,
  SwapPlugin,
  LiFiAggregator,
  JupiterAggregator,
  SkipGoAggregator,
  ZeroXAggregator,
  ParaSwapAggregator,
  PolymarketPlugin,
  GasPricePlugin,
  PortfolioPlugin,
  TxStatusPlugin,
  ApprovePlugin,
  BridgePlugin,
  EnsPlugin,
  LendingPlugin,
  WalletIntelligencePlugin,
  YieldFinderPlugin,
} from "./plugins/index.js";
import { registerAllTools } from "./tools/register.js";

// Scanners & Yield Sources
import { NativeBalanceScanner } from "./plugins/wallet-intelligence/scanners/native-scanner.js";
import { Erc20Scanner } from "./plugins/wallet-intelligence/scanners/erc20-scanner.js";
import { AaveV3Scanner } from "./plugins/wallet-intelligence/scanners/aave-scanner.js";
import { UniswapV3LPScanner } from "./plugins/wallet-intelligence/scanners/uniswap-v3-scanner.js";
import { AaveYieldSource } from "./plugins/yield-finder/sources/aave-yield-source.js";
import { CompoundV3YieldSource } from "./plugins/yield-finder/sources/compound-v3-yield-source.js";
import { LidoYieldSource } from "./plugins/yield-finder/sources/lido-yield-source.js";
import { CompoundV3Scanner } from "./plugins/wallet-intelligence/scanners/compound-v3-scanner.js";
import { LidoScanner } from "./plugins/wallet-intelligence/scanners/lido-scanner.js";
import { PolymarketScanner } from "./plugins/wallet-intelligence/scanners/polymarket-scanner.js";

async function main() {
  const config = loadConfig();

  // 1. Create registry
  const registry = new Registry(config);

  // 2. Register chain adapters
  registry.registerChainAdapter(
    new EvmChainAdapter(EVM_CHAINS, config.rpcUrls)
  );
  registry.registerChainAdapter(
    new SolanaChainAdapter(SOLANA_CHAINS, config.rpcUrls)
  );
  registry.registerChainAdapter(
    new CosmosChainAdapter(COSMOS_CHAINS, config.rpcUrls)
  );

  // 3. Register plugins
  await registry.registerPlugin(
    new TokenInfoPlugin(config.apiKeys.coingecko)
  );
  await registry.registerPlugin(new BalancesPlugin());
  await registry.registerPlugin(
    new SwapPlugin([
      new LiFiAggregator(),
      new JupiterAggregator(),
      new SkipGoAggregator(),
      new ZeroXAggregator(),
      new ParaSwapAggregator(),
    ])
  );
  await registry.registerPlugin(new GasPricePlugin());
  await registry.registerPlugin(new PortfolioPlugin());
  await registry.registerPlugin(new TxStatusPlugin());
  await registry.registerPlugin(new ApprovePlugin());
  await registry.registerPlugin(new BridgePlugin());
  await registry.registerPlugin(new EnsPlugin());
  await registry.registerPlugin(new LendingPlugin());
  await registry.registerPlugin(new PolymarketPlugin());

  // 3b. Register protocol scanners (for wallet intelligence)
  registry.registerScanner(new NativeBalanceScanner());
  registry.registerScanner(new Erc20Scanner());
  registry.registerScanner(new AaveV3Scanner());
  registry.registerScanner(new UniswapV3LPScanner());
  registry.registerScanner(new CompoundV3Scanner());
  registry.registerScanner(new LidoScanner());
  registry.registerScanner(new PolymarketScanner());

  // 3c. Register yield sources (for intent engine)
  registry.registerYieldSource(new AaveYieldSource());
  registry.registerYieldSource(new CompoundV3YieldSource());
  registry.registerYieldSource(new LidoYieldSource());

  // 3d. Register intelligence plugins
  await registry.registerPlugin(new WalletIntelligencePlugin());
  await registry.registerPlugin(new YieldFinderPlugin());

  // 4. Create MCP server
  const server = new McpServer({
    name: "defi-mcp",
    version: "1.0.0",
  });

  // 5. Register all tools onto the MCP server
  registerAllTools(server, registry);

  // 6. Start stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Graceful shutdown
  process.on("SIGINT", async () => {
    await registry.shutdown();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error starting defi-mcp:", err);
  process.exit(1);
});
