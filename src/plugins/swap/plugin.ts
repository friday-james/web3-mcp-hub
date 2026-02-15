import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";
import { TokenNotFoundError } from "../../core/errors.js";
import {
  SwapQuoteInputSchema,
  SwapBuildTxInputSchema,
} from "../../tools/schemas.js";
import type { SwapAggregator } from "./aggregators/types.js";

export class SwapPlugin implements DefiPlugin {
  readonly name = "swap";
  readonly description =
    "Token swap quotes and unsigned transaction building via DEX aggregators";
  readonly version = "1.0.0";

  private aggregatorIndex = new Map<string, SwapAggregator>();

  constructor(private aggregators: SwapAggregator[]) {
    for (const agg of aggregators) {
      for (const chainId of agg.getSupportedChainIds()) {
        // First aggregator registered for a chain wins
        if (!this.aggregatorIndex.has(chainId)) {
          this.aggregatorIndex.set(chainId, agg);
        }
      }
    }
  }

  async initialize(_context: PluginContext): Promise<void> {}

  private getAggregatorForChain(chainId: string): SwapAggregator {
    const agg = this.aggregatorIndex.get(chainId);
    if (!agg) {
      throw new Error(
        `No swap aggregator available for chain "${chainId}". Supported chains: ${[...this.aggregatorIndex.keys()].join(", ")}`
      );
    }
    return agg;
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "defi_swap_quote",
        description:
          "Get a swap quote for exchanging one token for another on a specific chain. Returns expected output amount, price impact, and routing information. Does NOT execute any transaction.",
        inputSchema: SwapQuoteInputSchema,
        handler: async (
          input: unknown,
          context: PluginContext
        ): Promise<ToolResult> => {
          const { chainId, srcToken, dstToken, amount, slippageBps } =
            input as {
              chainId: string;
              srcToken: string;
              dstToken: string;
              amount: string;
              slippageBps?: number;
            };

          const adapter = context.getChainAdapterForChain(chainId);
          const chain = adapter.getChain(chainId)!;
          const aggregator = this.getAggregatorForChain(chainId);

          // Resolve token symbols to addresses
          const resolvedSrc = await adapter.resolveToken(chainId, srcToken);
          const resolvedDst = await adapter.resolveToken(chainId, dstToken);

          if (!resolvedSrc) throw new TokenNotFoundError(srcToken, chainId);
          if (!resolvedDst) throw new TokenNotFoundError(dstToken, chainId);

          const quote = await aggregator.getQuote(
            {
              chainId,
              srcToken: resolvedSrc.address,
              dstToken: resolvedDst.address,
              amount,
              slippageBps:
                slippageBps || context.config.defaultSlippageBps,
              userAddress: "",
            },
            chain
          );

          // Enrich quote with resolved token info
          quote.srcToken = resolvedSrc;
          quote.dstToken = resolvedDst;

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(quote, null, 2),
              },
            ],
          };
        },
      },
      {
        name: "defi_swap_build_tx",
        description:
          "Build an unsigned swap transaction. Returns transaction data that must be signed by the user's wallet. This tool NEVER handles private keys or signs transactions.",
        inputSchema: SwapBuildTxInputSchema,
        handler: async (
          input: unknown,
          context: PluginContext
        ): Promise<ToolResult> => {
          const {
            chainId,
            srcToken,
            dstToken,
            amount,
            slippageBps,
            userAddress,
          } = input as {
            chainId: string;
            srcToken: string;
            dstToken: string;
            amount: string;
            slippageBps?: number;
            userAddress: string;
          };

          const adapter = context.getChainAdapterForChain(chainId);
          const chain = adapter.getChain(chainId)!;
          const aggregator = this.getAggregatorForChain(chainId);

          // Validate user address
          if (!adapter.isValidAddress(chainId, userAddress)) {
            return {
              content: [
                {
                  type: "text",
                  text: `Invalid address "${userAddress}" for chain "${chainId}"`,
                },
              ],
              isError: true,
            };
          }

          // Resolve token symbols to addresses
          const resolvedSrc = await adapter.resolveToken(chainId, srcToken);
          const resolvedDst = await adapter.resolveToken(chainId, dstToken);

          if (!resolvedSrc) throw new TokenNotFoundError(srcToken, chainId);
          if (!resolvedDst) throw new TokenNotFoundError(dstToken, chainId);

          const tx = await aggregator.buildTransaction(
            {
              chainId,
              srcToken: resolvedSrc.address,
              dstToken: resolvedDst.address,
              amount,
              slippageBps:
                slippageBps || context.config.defaultSlippageBps,
              userAddress,
            },
            chain
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(tx, null, 2),
              },
            ],
          };
        },
      },
    ];
  }
}
