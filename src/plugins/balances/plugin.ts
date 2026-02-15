import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";
import { GetBalancesInputSchema } from "../../tools/schemas.js";

export class BalancesPlugin implements DefiPlugin {
  readonly name = "balances";
  readonly description = "Wallet balance lookups across chains";
  readonly version = "1.0.0";

  async initialize(_context: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [
      {
        name: "defi_get_balances",
        description:
          "Get token balances for a wallet address on a specific chain. If no token addresses are specified, returns the native token balance (ETH, SOL, ATOM, etc.).",
        inputSchema: GetBalancesInputSchema,
        handler: async (input: unknown, context: PluginContext): Promise<ToolResult> => {
          const { chainId, address, tokens } = input as {
            chainId: string;
            address: string;
            tokens?: string[];
          };

          const adapter = context.getChainAdapterForChain(chainId);

          if (!adapter.isValidAddress(chainId, address)) {
            return {
              content: [
                {
                  type: "text",
                  text: `Invalid address "${address}" for chain "${chainId}"`,
                },
              ],
              isError: true,
            };
          }

          const balances = [];

          // Always include native balance
          const nativeBalance = await adapter.getNativeBalance(
            chainId,
            address
          );
          balances.push(nativeBalance);

          // Fetch token balances if requested
          if (tokens && tokens.length > 0) {
            const tokenBalances = await adapter.getTokenBalances(
              chainId,
              address,
              tokens
            );
            balances.push(...tokenBalances);
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(balances, null, 2),
              },
            ],
          };
        },
      },
    ];
  }
}
