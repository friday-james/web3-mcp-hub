import { z } from "zod";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";

const DEXSCREENER_API = "https://api.dexscreener.com/latest/dex";

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function errorResult(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }], isError: true };
}

export class DexScreenerPlugin implements DefiPlugin {
  readonly name = "dex-screener";
  readonly description = "DexScreener: real-time DEX pair data, new pairs, and token search";
  readonly version = "1.0.0";

  async initialize(_ctx: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [
      this.searchPairsTool(),
      this.tokenPairsTool(),
      this.trendingTool(),
    ];
  }

  private searchPairsTool(): ToolDefinition {
    return {
      name: "defi_dex_search",
      description:
        "Search DEX trading pairs across all chains by token name, symbol, or address. Returns real-time price, volume, liquidity, and price changes from DexScreener.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("Token name, symbol, or address to search"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { query } = input as { query: string };
          const res = await fetch(`${DEXSCREENER_API}/search?q=${encodeURIComponent(query)}`);
          if (!res.ok) throw new Error(`DexScreener API ${res.status}`);
          const data = await res.json();

          const pairs = (data.pairs || []).slice(0, 15).map((p: any) => ({
            chain: p.chainId,
            dex: p.dexId,
            pair: `${p.baseToken?.symbol}/${p.quoteToken?.symbol}`,
            pairAddress: p.pairAddress,
            priceUsd: p.priceUsd ? `$${p.priceUsd}` : undefined,
            priceChange: {
              m5: p.priceChange?.m5 ? `${p.priceChange.m5}%` : undefined,
              h1: p.priceChange?.h1 ? `${p.priceChange.h1}%` : undefined,
              h6: p.priceChange?.h6 ? `${p.priceChange.h6}%` : undefined,
              h24: p.priceChange?.h24 ? `${p.priceChange.h24}%` : undefined,
            },
            volume24h: p.volume?.h24 ? `$${Number(p.volume.h24).toFixed(0)}` : undefined,
            liquidity: p.liquidity?.usd ? `$${Number(p.liquidity.usd).toFixed(0)}` : undefined,
            fdv: p.fdv ? `$${Number(p.fdv).toFixed(0)}` : undefined,
            baseToken: {
              symbol: p.baseToken?.symbol,
              address: p.baseToken?.address,
            },
            quoteToken: {
              symbol: p.quoteToken?.symbol,
              address: p.quoteToken?.address,
            },
            url: p.url,
          }));

          return jsonResult({ query, resultCount: pairs.length, pairs });
        } catch (e: any) {
          return errorResult(`DexScreener search failed: ${e.message}`);
        }
      },
    };
  }

  private tokenPairsTool(): ToolDefinition {
    return {
      name: "defi_dex_token_pairs",
      description:
        "Get all DEX trading pairs for a specific token address. Shows price, volume, liquidity across all DEXes and chains where the token trades.",
      inputSchema: z.object({
        tokenAddress: z.string().describe("Token contract address"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { tokenAddress } = input as { tokenAddress: string };
          const res = await fetch(`${DEXSCREENER_API}/tokens/${tokenAddress}`);
          if (!res.ok) throw new Error(`DexScreener API ${res.status}`);
          const data = await res.json();

          const pairs = (data.pairs || []).slice(0, 20).map((p: any) => ({
            chain: p.chainId,
            dex: p.dexId,
            pair: `${p.baseToken?.symbol}/${p.quoteToken?.symbol}`,
            pairAddress: p.pairAddress,
            priceUsd: p.priceUsd ? `$${p.priceUsd}` : undefined,
            priceChange24h: p.priceChange?.h24 ? `${p.priceChange.h24}%` : undefined,
            volume24h: p.volume?.h24 ? `$${Number(p.volume.h24).toFixed(0)}` : undefined,
            liquidity: p.liquidity?.usd ? `$${Number(p.liquidity.usd).toFixed(0)}` : undefined,
            txns24h: p.txns?.h24 ? { buys: p.txns.h24.buys, sells: p.txns.h24.sells } : undefined,
          }));

          return jsonResult({ token: tokenAddress, pairCount: pairs.length, pairs });
        } catch (e: any) {
          return errorResult(`Failed to fetch token pairs: ${e.message}`);
        }
      },
    };
  }

  private trendingTool(): ToolDefinition {
    return {
      name: "defi_dex_trending",
      description:
        "Get trending/boosted tokens on DexScreener. Shows the most actively traded new tokens across all DEXes.",
      inputSchema: z.object({}),
      handler: async (): Promise<ToolResult> => {
        try {
          const res = await fetch("https://api.dexscreener.com/token-boosts/latest/v1");
          if (!res.ok) throw new Error(`DexScreener API ${res.status}`);
          const data = await res.json();

          const tokens = (Array.isArray(data) ? data : []).slice(0, 20).map((t: any) => ({
            chain: t.chainId,
            tokenAddress: t.tokenAddress,
            description: t.description,
            url: t.url,
            icon: t.icon,
            links: t.links,
          }));

          return jsonResult({ count: tokens.length, trending: tokens });
        } catch (e: any) {
          return errorResult(`Failed to fetch trending tokens: ${e.message}`);
        }
      },
    };
  }
}
