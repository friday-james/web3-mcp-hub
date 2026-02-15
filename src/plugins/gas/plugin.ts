import { z } from "zod";
import { createPublicClient, http, formatGwei } from "viem";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";
import { ChainIdSchema } from "../../tools/schemas.js";
import { CHAIN_ID_MAP } from "../../chains/evm/chains.js";

export class GasPricePlugin implements DefiPlugin {
  readonly name = "gas-price";
  readonly description = "Gas price lookups across chains";
  readonly version = "1.0.0";

  async initialize(_context: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [
      {
        name: "defi_gas_price",
        description:
          "Get current gas prices for a blockchain network. For EVM chains returns slow/standard/fast estimates in gwei. For Solana returns priority fee levels.",
        inputSchema: z.object({ chainId: ChainIdSchema }),
        handler: async (
          input: unknown,
          context: PluginContext
        ): Promise<ToolResult> => {
          const { chainId } = input as { chainId: string };
          const adapter = context.getChainAdapterForChain(chainId);
          const chain = adapter.getChain(chainId);
          if (!chain)
            return {
              content: [{ type: "text", text: `Chain "${chainId}" not found` }],
              isError: true,
            };

          if (chain.ecosystem === "evm") {
            const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
            const client = createPublicClient({ transport: http(rpcUrl) });

            const feeData = await client.estimateFeesPerGas();
            const gasPrice = await client.getGasPrice();

            const result = {
              chain: chain.name,
              chainId: chain.id,
              gasPrice: formatGwei(gasPrice) + " gwei",
              maxFeePerGas: feeData.maxFeePerGas
                ? formatGwei(feeData.maxFeePerGas) + " gwei"
                : undefined,
              maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
                ? formatGwei(feeData.maxPriorityFeePerGas) + " gwei"
                : undefined,
            };

            return {
              content: [
                { type: "text", text: JSON.stringify(result, null, 2) },
              ],
            };
          }

          if (chain.ecosystem === "solana") {
            const { Connection } = await import("@solana/web3.js");
            const rpcUrl =
              context.config.rpcUrls[chainId] || chain.rpcUrl;
            const connection = new Connection(rpcUrl, "confirmed");
            const fees = await connection.getRecentPrioritizationFees();
            const sorted = fees
              .map((f) => f.prioritizationFee)
              .sort((a, b) => a - b);

            const result = {
              chain: chain.name,
              chainId: chain.id,
              priorityFees: {
                min: sorted[0] || 0,
                median: sorted[Math.floor(sorted.length / 2)] || 0,
                max: sorted[sorted.length - 1] || 0,
              },
              unit: "micro-lamports per compute unit",
            };

            return {
              content: [
                { type: "text", text: JSON.stringify(result, null, 2) },
              ],
            };
          }

          return {
            content: [
              {
                type: "text",
                text: `Gas price not available for ${chain.ecosystem} chains yet`,
              },
            ],
          };
        },
      },
    ];
  }
}
