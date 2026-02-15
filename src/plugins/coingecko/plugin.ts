import { z } from "zod";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";

const CG_API = "https://api.coingecko.com/api/v3";

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function errorResult(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }], isError: true };
}

async function cgFetch(path: string, apiKey?: string): Promise<any> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (apiKey) headers["x-cg-demo-api-key"] = apiKey;
  const res = await fetch(`${CG_API}${path}`, { headers });
  if (!res.ok) throw new Error(`CoinGecko API ${res.status}: ${await res.text()}`);
  return res.json();
}

export class CoinGeckoPlugin implements DefiPlugin {
  readonly name = "coingecko";
  readonly description = "CoinGecko market intelligence: trending tokens, global data, categories";
  readonly version = "1.0.0";

  private apiKey?: string;

  async initialize(context: PluginContext): Promise<void> {
    this.apiKey = context.config.apiKeys.coingecko;
  }

  getTools(): ToolDefinition[] {
    return [
      this.trendingTool(),
      this.globalMarketTool(),
      this.categoriesTool(),
      this.topTokensTool(),
    ];
  }

  private trendingTool(): ToolDefinition {
    return {
      name: "defi_trending_tokens",
      description: "Get the top trending tokens on CoinGecko in the last 24 hours. Shows what the crypto market is most interested in right now.",
      inputSchema: z.object({}),
      handler: async (): Promise<ToolResult> => {
        try {
          const data = await cgFetch("/search/trending", this.apiKey);
          const coins = (data.coins || []).map((item: any) => {
            const c = item.item;
            return {
              name: c.name,
              symbol: c.symbol,
              marketCapRank: c.market_cap_rank,
              priceUsd: c.data?.price,
              priceChange24h: c.data?.price_change_percentage_24h?.usd
                ? `${c.data.price_change_percentage_24h.usd.toFixed(2)}%`
                : undefined,
              marketCap: c.data?.market_cap,
              volume24h: c.data?.total_volume,
              sparkline: c.data?.sparkline,
            };
          });

          const nfts = (data.nfts || []).slice(0, 5).map((n: any) => ({
            name: n.name,
            symbol: n.symbol,
            floorPrice: n.data?.floor_price,
            volume24h: n.data?.h24_volume,
          }));

          return jsonResult({ trending: { coins, nfts } });
        } catch (e: any) {
          return errorResult(`Failed to fetch trending: ${e.message}`);
        }
      },
    };
  }

  private globalMarketTool(): ToolDefinition {
    return {
      name: "defi_global_market",
      description: "Get global cryptocurrency market statistics: total market cap, 24h volume, BTC/ETH dominance, active cryptocurrencies count, and market cap changes.",
      inputSchema: z.object({}),
      handler: async (): Promise<ToolResult> => {
        try {
          const data = await cgFetch("/global", this.apiKey);
          const g = data.data;
          return jsonResult({
            activeCryptocurrencies: g.active_cryptocurrencies,
            markets: g.markets,
            totalMarketCap: `$${(g.total_market_cap?.usd / 1e12).toFixed(2)}T`,
            totalVolume24h: `$${(g.total_volume?.usd / 1e9).toFixed(1)}B`,
            btcDominance: `${g.market_cap_percentage?.btc?.toFixed(1)}%`,
            ethDominance: `${g.market_cap_percentage?.eth?.toFixed(1)}%`,
            marketCapChange24h: `${g.market_cap_change_percentage_24h_usd?.toFixed(2)}%`,
            defiMarketCap: g.total_market_cap?.usd
              ? `$${((g.defi_volume_24h || 0) / 1e9).toFixed(1)}B defi volume`
              : undefined,
          });
        } catch (e: any) {
          return errorResult(`Failed to fetch global market data: ${e.message}`);
        }
      },
    };
  }

  private categoriesTool(): ToolDefinition {
    return {
      name: "defi_token_categories",
      description: "Get cryptocurrency categories (DeFi, Gaming, AI, Layer-1, etc.) with market cap, volume, and 24h change for each category.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).optional().describe("Number of categories (default 20)"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { limit = 20 } = input as { limit?: number };
          const data = await cgFetch("/coins/categories?order=market_cap_desc", this.apiKey);

          const categories = (data || []).slice(0, limit).map((c: any) => ({
            name: c.name,
            marketCap: c.market_cap ? `$${(c.market_cap / 1e9).toFixed(1)}B` : "N/A",
            marketCapChange24h: c.market_cap_change_24h
              ? `${c.market_cap_change_24h.toFixed(2)}%`
              : "N/A",
            volume24h: c.volume_24h ? `$${(c.volume_24h / 1e9).toFixed(1)}B` : "N/A",
            topCoins: c.top_3_coins?.length || 0,
          }));

          return jsonResult({ categoryCount: categories.length, categories });
        } catch (e: any) {
          return errorResult(`Failed to fetch categories: ${e.message}`);
        }
      },
    };
  }

  private topTokensTool(): ToolDefinition {
    return {
      name: "defi_top_tokens",
      description: "Get top cryptocurrencies by market cap with price, volume, and 24h/7d change. Useful for market overview and portfolio analysis.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).optional().describe("Number of tokens (default 25)"),
        category: z.string().optional().describe('Filter by category ID (e.g. "decentralized-finance-defi", "layer-1", "artificial-intelligence")'),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { limit = 25, category } = input as { limit?: number; category?: string };
          let path = `/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&sparkline=false`;
          if (category) path += `&category=${encodeURIComponent(category)}`;

          const data = await cgFetch(path, this.apiKey);

          const tokens = (data || []).map((c: any) => ({
            rank: c.market_cap_rank,
            name: c.name,
            symbol: c.symbol.toUpperCase(),
            price: `$${c.current_price}`,
            marketCap: `$${(c.market_cap / 1e9).toFixed(2)}B`,
            volume24h: `$${(c.total_volume / 1e9).toFixed(2)}B`,
            change24h: `${c.price_change_percentage_24h?.toFixed(2)}%`,
            ath: `$${c.ath}`,
            athChangePercent: `${c.ath_change_percentage?.toFixed(1)}%`,
          }));

          return jsonResult({ count: tokens.length, tokens });
        } catch (e: any) {
          return errorResult(`Failed to fetch top tokens: ${e.message}`);
        }
      },
    };
  }
}
