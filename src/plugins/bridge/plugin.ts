import { z } from "zod";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";
import { ChainIdSchema, AddressSchema, AmountSchema, SlippageSchema } from "../../tools/schemas.js";

const LIFI_API = "https://li.quest/v1";

/** Map chain IDs to Li.Fi numeric chain IDs */
const CHAIN_ID_MAP: Record<string, number> = {
  ethereum: 1,
  polygon: 137,
  arbitrum: 42161,
  base: 8453,
  optimism: 10,
  avalanche: 43114,
  bsc: 56,
};

export class BridgePlugin implements DefiPlugin {
  readonly name = "bridge";
  readonly description = "Cross-chain bridge quotes and transactions via Li.Fi";
  readonly version = "1.0.0";

  async initialize(_context: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [
      {
        name: "defi_bridge_quote",
        description:
          "Get a cross-chain bridge quote for moving tokens between different chains. Uses Li.Fi aggregator which finds the best bridge route (Stargate, Across, Hop, etc.).",
        inputSchema: z.object({
          fromChainId: ChainIdSchema.describe("Source chain ID"),
          toChainId: ChainIdSchema.describe("Destination chain ID"),
          fromToken: z.string().describe("Source token address"),
          toToken: z.string().describe("Destination token address"),
          amount: AmountSchema,
          userAddress: AddressSchema.describe("Your wallet address"),
          slippageBps: SlippageSchema,
        }),
        handler: async (
          input: unknown,
          context: PluginContext
        ): Promise<ToolResult> => {
          const {
            fromChainId,
            toChainId,
            fromToken,
            toToken,
            amount,
            userAddress,
            slippageBps,
          } = input as {
            fromChainId: string;
            toChainId: string;
            fromToken: string;
            toToken: string;
            amount: string;
            userAddress: string;
            slippageBps?: number;
          };

          const fromNumeric = CHAIN_ID_MAP[fromChainId];
          const toNumeric = CHAIN_ID_MAP[toChainId];

          if (!fromNumeric || !toNumeric) {
            return {
              content: [
                {
                  type: "text",
                  text: `Bridge only supports EVM chains: ${Object.keys(CHAIN_ID_MAP).join(", ")}`,
                },
              ],
              isError: true,
            };
          }

          // Resolve token addresses
          const fromAdapter = context.getChainAdapterForChain(fromChainId);
          const toAdapter = context.getChainAdapterForChain(toChainId);
          const resolvedFrom = await fromAdapter.resolveToken(
            fromChainId,
            fromToken
          );
          const resolvedTo = await toAdapter.resolveToken(
            toChainId,
            toToken
          );

          const { parseTokenAmount } = await import("../../core/utils.js");
          const fromDecimals = resolvedFrom?.decimals ?? 18;
          const fromAmountRaw = parseTokenAmount(amount, fromDecimals);

          const params = new URLSearchParams({
            fromChain: fromNumeric.toString(),
            toChain: toNumeric.toString(),
            fromToken: resolvedFrom?.address || fromToken,
            toToken: resolvedTo?.address || toToken,
            fromAmount: fromAmountRaw,
            fromAddress: userAddress,
            slippage: ((slippageBps || 50) / 10000).toString(),
          });

          const res = await fetch(`${LIFI_API}/quote?${params}`);
          if (!res.ok) {
            const err = await res.text();
            return {
              content: [
                { type: "text", text: `Bridge quote failed: ${err}` },
              ],
              isError: true,
            };
          }

          const data = await res.json();
          const { formatTokenAmount } = await import("../../core/utils.js");

          const result = {
            bridge: data.tool,
            fromChain: fromChainId,
            toChain: toChainId,
            fromToken: {
              symbol: data.action.fromToken.symbol,
              amount: formatTokenAmount(
                data.estimate.fromAmount,
                data.action.fromToken.decimals
              ),
            },
            toToken: {
              symbol: data.action.toToken.symbol,
              amount: formatTokenAmount(
                data.estimate.toAmount,
                data.action.toToken.decimals
              ),
              minimumAmount: formatTokenAmount(
                data.estimate.toAmountMin,
                data.action.toToken.decimals
              ),
            },
            estimatedTime: data.estimate.executionDuration
              ? `${Math.round(data.estimate.executionDuration / 60)} minutes`
              : undefined,
            gasCost: data.estimate.gasCosts?.[0]
              ? `${data.estimate.gasCosts[0].amountUSD} USD`
              : undefined,
            transaction: data.transactionRequest
              ? {
                  to: data.transactionRequest.to,
                  data: data.transactionRequest.data,
                  value: data.transactionRequest.value,
                  gasLimit: data.transactionRequest.gasLimit,
                  chainId: fromNumeric,
                }
              : undefined,
          };

          return {
            content: [
              { type: "text", text: JSON.stringify(result, null, 2) },
            ],
          };
        },
      },
    ];
  }
}
