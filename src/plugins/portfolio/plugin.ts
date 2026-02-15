import { z } from "zod";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
  TokenBalance,
  ChainInfo,
} from "../../core/types.js";
import { AddressSchema } from "../../tools/schemas.js";
import { CoinGeckoClient } from "../token-info/coingecko.js";

export class PortfolioPlugin implements DefiPlugin {
  readonly name = "portfolio";
  readonly description = "Cross-chain portfolio overview";
  readonly version = "1.0.0";

  private coingecko!: CoinGeckoClient;

  async initialize(context: PluginContext): Promise<void> {
    this.coingecko = new CoinGeckoClient(context.config.apiKeys.coingecko);
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "defi_portfolio",
        description:
          "Get a portfolio overview for a wallet address across multiple chains. Pass the address and which chains to check. Returns native token balances with USD values.",
        inputSchema: z.object({
          address: AddressSchema.describe("Wallet address to check"),
          chainIds: z
            .array(z.string())
            .optional()
            .describe(
              'Chain IDs to check. If omitted, checks all EVM chains for EVM addresses, Solana for Solana addresses.'
            ),
        }),
        handler: async (
          input: unknown,
          context: PluginContext
        ): Promise<ToolResult> => {
          const { address, chainIds } = input as {
            address: string;
            chainIds?: string[];
          };

          const allChains = context.getAllChains();

          // Determine which chains to check
          let chainsToCheck: ChainInfo[];
          if (chainIds && chainIds.length > 0) {
            chainsToCheck = allChains.filter((c) =>
              chainIds.includes(c.id)
            );
          } else {
            // Auto-detect based on address format
            if (address.startsWith("0x")) {
              chainsToCheck = allChains.filter(
                (c) => c.ecosystem === "evm"
              );
            } else {
              chainsToCheck = allChains.filter(
                (c) => c.ecosystem !== "evm"
              );
            }
          }

          const results: Array<{
            chain: string;
            chainId: string;
            balance: string;
            symbol: string;
            balanceUsd?: string;
          }> = [];

          // Fetch native balances in parallel
          const balancePromises = chainsToCheck.map(async (chain) => {
            try {
              const adapter = context.getChainAdapterForChain(chain.id);
              if (!adapter.isValidAddress(chain.id, address)) return null;
              const balance = await adapter.getNativeBalance(
                chain.id,
                address
              );
              return { chain, balance };
            } catch {
              return null;
            }
          });

          const balances = await Promise.all(balancePromises);

          // Get prices for native tokens
          const nativeTokens = chainsToCheck.map((c) => c.nativeToken);
          const uniqueIds = [
            ...new Set(
              nativeTokens
                .filter((t) => t.coingeckoId)
                .map((t) => t.coingeckoId!)
            ),
          ];
          let priceMap: Record<string, number> = {};
          try {
            const priceData =
              await this.coingecko.getPricesByIds(uniqueIds);
            for (const [id, data] of Object.entries(priceData)) {
              priceMap[id] = data.usd;
            }
          } catch {
            // Price lookup failed, continue without USD values
          }

          let totalUsd = 0;

          for (const result of balances) {
            if (!result) continue;
            const { chain, balance } = result;
            const usdPrice =
              chain.nativeToken.coingeckoId
                ? priceMap[chain.nativeToken.coingeckoId]
                : undefined;
            const balanceNum = parseFloat(balance.balanceFormatted);
            const usdValue = usdPrice ? balanceNum * usdPrice : undefined;

            if (usdValue !== undefined) totalUsd += usdValue;

            results.push({
              chain: chain.name,
              chainId: chain.id,
              balance: balance.balanceFormatted,
              symbol: chain.nativeToken.symbol,
              balanceUsd: usdValue !== undefined
                ? `$${usdValue.toFixed(2)}`
                : undefined,
            });
          }

          const portfolio = {
            address,
            totalValueUsd: `$${totalUsd.toFixed(2)}`,
            chains: results.filter(
              (r) => parseFloat(r.balance) > 0
            ),
            emptyChains: results
              .filter((r) => parseFloat(r.balance) === 0)
              .map((r) => r.chainId),
          };

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(portfolio, null, 2),
              },
            ],
          };
        },
      },
    ];
  }
}
