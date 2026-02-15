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
  GasPricePlugin,
  PortfolioPlugin,
  TxStatusPlugin,
  ApprovePlugin,
  BridgePlugin,
  EnsPlugin,
  LendingPlugin,
} from "./plugins/index.js";
import { registerAllTools } from "./tools/register.js";

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
    ])
  );
  await registry.registerPlugin(new GasPricePlugin());
  await registry.registerPlugin(new PortfolioPlugin());
  await registry.registerPlugin(new TxStatusPlugin());
  await registry.registerPlugin(new ApprovePlugin());
  await registry.registerPlugin(new BridgePlugin());
  await registry.registerPlugin(new EnsPlugin());
  await registry.registerPlugin(new LendingPlugin());

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
