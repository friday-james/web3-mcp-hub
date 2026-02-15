import { z } from "zod";
import { createPublicClient, http, formatGwei, formatEther } from "viem";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function errorResult(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }], isError: true };
}

// Average gas units for common DeFi operations
const GAS_ESTIMATES: Record<string, number> = {
  "ETH transfer": 21000,
  "ERC20 transfer": 65000,
  "ERC20 approve": 46000,
  "Uniswap V3 swap": 185000,
  "Uniswap V2 swap": 152000,
  "Aave V3 supply": 250000,
  "Aave V3 borrow": 320000,
  "Aave V3 repay": 280000,
  "Compound V3 supply": 200000,
  "Lido stake": 90000,
  "wstETH wrap": 65000,
  "NFT transfer": 85000,
  "NFT mint": 150000,
  "Bridge (Li.Fi)": 350000,
};

const EVM_CHAINS = [
  "ethereum", "arbitrum", "optimism", "polygon", "base", "avalanche", "bsc",
];

export class GasOptimizerPlugin implements DefiPlugin {
  readonly name = "gas-optimizer";
  readonly description = "Gas cost comparison across chains and operations";
  readonly version = "1.0.0";

  async initialize(_ctx: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [this.compareGasTool(), this.operationCostTool()];
  }

  private compareGasTool(): ToolDefinition {
    return {
      name: "defi_compare_gas",
      description:
        "Compare current gas costs across all EVM chains. Shows gas price and typical transaction costs to help choose the cheapest chain for an operation.",
      inputSchema: z.object({
        operation: z
          .string()
          .optional()
          .describe(
            `Operation to estimate cost for. Options: ${Object.keys(GAS_ESTIMATES).join(", ")}. Default: "ERC20 transfer"`
          ),
      }),
      handler: async (
        input: unknown,
        context: PluginContext
      ): Promise<ToolResult> => {
        try {
          const { operation = "ERC20 transfer" } = input as {
            operation?: string;
          };
          const gasUnits = GAS_ESTIMATES[operation] || 65000;

          const results = await Promise.allSettled(
            EVM_CHAINS.map(async (chainId) => {
              const adapter = context.getChainAdapterForChain(chainId);
              const chain = adapter.getChain(chainId);
              if (!chain) return null;

              const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
              const client = createPublicClient({ transport: http(rpcUrl) });

              const gasPrice = await client.getGasPrice();
              const costWei = gasPrice * BigInt(gasUnits);

              // Get native token USD price from CoinGecko
              let nativeUsdPrice = 0;
              try {
                const cgId: Record<string, string> = {
                  ethereum: "ethereum",
                  arbitrum: "ethereum",
                  optimism: "ethereum",
                  base: "ethereum",
                  polygon: "matic-network",
                  avalanche: "avalanche-2",
                  bsc: "binancecoin",
                };
                const id = cgId[chainId];
                if (id) {
                  const priceRes = await fetch(
                    `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`
                  );
                  if (priceRes.ok) {
                    const priceData = await priceRes.json();
                    nativeUsdPrice = priceData[id]?.usd || 0;
                  }
                }
              } catch {}

              const costNative = Number(formatEther(costWei));
              const costUsd = costNative * nativeUsdPrice;

              return {
                chain: chain.name,
                chainId,
                gasPrice: `${formatGwei(gasPrice)} gwei`,
                costNative: `${costNative.toFixed(6)} ${chain.nativeToken.symbol}`,
                costUsd: nativeUsdPrice > 0 ? `$${costUsd.toFixed(4)}` : "price unavailable",
                costUsdRaw: costUsd,
              };
            })
          );

          const chains = results
            .filter(
              (r): r is PromiseFulfilledResult<any> =>
                r.status === "fulfilled" && r.value !== null
            )
            .map((r) => r.value)
            .sort((a, b) => a.costUsdRaw - b.costUsdRaw);

          // Remove raw field
          chains.forEach((c: any) => delete c.costUsdRaw);

          const cheapest = chains[0];
          const mostExpensive = chains[chains.length - 1];

          return jsonResult({
            operation,
            gasUnits,
            cheapestChain: cheapest?.chainId,
            chains,
            tip:
              cheapest && mostExpensive
                ? `${cheapest.chain} is the cheapest at ${cheapest.costUsd}. ${mostExpensive.chain} is ${mostExpensive.costUsd}.`
                : undefined,
          });
        } catch (e: any) {
          return errorResult(`Gas comparison failed: ${e.message}`);
        }
      },
    };
  }

  private operationCostTool(): ToolDefinition {
    return {
      name: "defi_operation_costs",
      description:
        "Get estimated gas costs for all common DeFi operations on a specific chain. Useful for planning multi-step operations and budgeting gas.",
      inputSchema: z.object({
        chainId: z.string().describe("Chain to check gas costs on"),
      }),
      handler: async (
        input: unknown,
        context: PluginContext
      ): Promise<ToolResult> => {
        try {
          const { chainId } = input as { chainId: string };

          const adapter = context.getChainAdapterForChain(chainId);
          const chain = adapter.getChain(chainId);
          if (!chain || chain.ecosystem !== "evm") {
            return errorResult("Gas estimation only supported on EVM chains");
          }

          const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
          const client = createPublicClient({ transport: http(rpcUrl) });
          const gasPrice = await client.getGasPrice();

          // Get native token USD price
          let nativeUsdPrice = 0;
          try {
            const cgId: Record<string, string> = {
              ethereum: "ethereum", arbitrum: "ethereum", optimism: "ethereum",
              base: "ethereum", polygon: "matic-network",
              avalanche: "avalanche-2", bsc: "binancecoin",
            };
            const id = cgId[chainId];
            if (id) {
              const priceRes = await fetch(
                `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`
              );
              if (priceRes.ok) {
                const priceData = await priceRes.json();
                nativeUsdPrice = priceData[id]?.usd || 0;
              }
            }
          } catch {}

          const operations = Object.entries(GAS_ESTIMATES).map(
            ([op, gasUnits]) => {
              const costWei = gasPrice * BigInt(gasUnits);
              const costNative = Number(formatEther(costWei));
              const costUsd = costNative * nativeUsdPrice;
              return {
                operation: op,
                gasUnits,
                cost: `${costNative.toFixed(6)} ${chain.nativeToken.symbol}`,
                costUsd:
                  nativeUsdPrice > 0
                    ? `$${costUsd.toFixed(4)}`
                    : "price unavailable",
              };
            }
          );

          return jsonResult({
            chain: chain.name,
            chainId,
            gasPrice: `${formatGwei(gasPrice)} gwei`,
            nativeTokenPrice: nativeUsdPrice > 0 ? `$${nativeUsdPrice}` : "unavailable",
            operations,
          });
        } catch (e: any) {
          return errorResult(`Operation cost estimation failed: ${e.message}`);
        }
      },
    };
  }
}
