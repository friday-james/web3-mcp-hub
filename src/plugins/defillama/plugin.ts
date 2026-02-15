import { z } from "zod";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";

const LLAMA_API = "https://api.llama.fi";
const COINS_API = "https://coins.llama.fi";
const STABLECOINS_API = "https://stablecoins.llama.fi";

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function errorResult(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }], isError: true };
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export class DefiLlamaPlugin implements DefiPlugin {
  readonly name = "defillama";
  readonly description = "DeFi protocol analytics via DefiLlama: TVL, volumes, fees, stablecoins, prices";
  readonly version = "1.0.0";

  async initialize(_ctx: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [
      this.protocolsTool(),
      this.protocolTvlTool(),
      this.chainTvlTool(),
      this.stablecoinsTool(),
      this.dexVolumeTool(),
      this.protocolFeesTool(),
      this.priceChartTool(),
      this.historicalPriceTool(),
    ];
  }

  private protocolsTool(): ToolDefinition {
    return {
      name: "defi_protocols",
      description:
        "List top DeFi protocols ranked by TVL. Filter by category or chain. Returns name, TVL, chain breakdown, 24h/7d changes.",
      inputSchema: z.object({
        category: z
          .string()
          .optional()
          .describe('Filter by category (e.g. "Lending", "DEXes", "Liquid Staking", "CDP", "Yield")'),
        chain: z
          .string()
          .optional()
          .describe('Filter by chain (e.g. "Ethereum", "Arbitrum", "Solana")'),
        limit: z.number().int().min(1).max(100).optional().describe("Number of results (default 25)"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { category, chain, limit = 25 } = input as {
            category?: string; chain?: string; limit?: number;
          };
          const data = await fetchJson(`${LLAMA_API}/protocols`);

          let protocols = data as any[];

          if (category) {
            const cat = category.toLowerCase();
            protocols = protocols.filter(
              (p) => p.category?.toLowerCase() === cat
            );
          }
          if (chain) {
            const ch = chain.toLowerCase();
            protocols = protocols.filter((p) =>
              p.chains?.some((c: string) => c.toLowerCase() === ch)
            );
          }

          protocols.sort((a, b) => (b.tvl || 0) - (a.tvl || 0));

          const result = protocols.slice(0, limit).map((p) => ({
            name: p.name,
            symbol: p.symbol,
            category: p.category,
            tvl: p.tvl,
            chains: p.chains,
            change_24h: p.change_1d ? `${p.change_1d.toFixed(2)}%` : null,
            change_7d: p.change_7d ? `${p.change_7d.toFixed(2)}%` : null,
            slug: p.slug,
          }));

          return jsonResult({ count: result.length, protocols: result });
        } catch (e: any) {
          return errorResult(`Failed to fetch protocols: ${e.message}`);
        }
      },
    };
  }

  private protocolTvlTool(): ToolDefinition {
    return {
      name: "defi_protocol_tvl",
      description:
        "Get detailed TVL breakdown for a specific protocol including per-chain TVL, token breakdown, and recent changes.",
      inputSchema: z.object({
        protocol: z.string().describe('Protocol slug (e.g. "aave", "lido", "uniswap")'),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { protocol } = input as { protocol: string };
          const data = await fetchJson(`${LLAMA_API}/protocol/${protocol}`);

          const result = {
            name: data.name,
            symbol: data.symbol,
            category: data.category,
            description: data.description,
            tvl: data.tvl?.[data.tvl.length - 1]?.totalLiquidityUSD,
            chains: data.chains,
            chainTvls: Object.entries(data.currentChainTvls || {}).map(
              ([chain, tvl]) => ({ chain, tvl })
            ),
            change_24h: data.change_1d,
            change_7d: data.change_7d,
            mcap: data.mcap,
            url: data.url,
            twitter: data.twitter,
            audits: data.audits,
          };

          return jsonResult(result);
        } catch (e: any) {
          return errorResult(`Failed to fetch protocol: ${e.message}`);
        }
      },
    };
  }

  private chainTvlTool(): ToolDefinition {
    return {
      name: "defi_chain_tvl",
      description: "Get TVL ranking of all blockchain networks. Shows current TVL and protocol count per chain.",
      inputSchema: z.object({}),
      handler: async (): Promise<ToolResult> => {
        try {
          const data = await fetchJson(`${LLAMA_API}/v2/chains`);

          const chains = (data as any[])
            .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
            .map((c) => ({
              name: c.name,
              gecko_id: c.gecko_id,
              tvl: c.tvl,
              tokenSymbol: c.tokenSymbol,
            }));

          return jsonResult({ count: chains.length, chains });
        } catch (e: any) {
          return errorResult(`Failed to fetch chain TVL: ${e.message}`);
        }
      },
    };
  }

  private stablecoinsTool(): ToolDefinition {
    return {
      name: "defi_stablecoins",
      description:
        "List stablecoins with circulating supply, peg type, market cap, and chain distribution.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).optional().describe("Number of results (default 20)"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { limit = 20 } = input as { limit?: number };
          const data = await fetchJson(
            `${STABLECOINS_API}/stablecoins?includePrices=true`
          );

          const stables = (data.peggedAssets as any[])
            .sort(
              (a, b) =>
                (b.circulating?.peggedUSD || 0) - (a.circulating?.peggedUSD || 0)
            )
            .slice(0, limit)
            .map((s) => ({
              name: s.name,
              symbol: s.symbol,
              pegType: s.pegType,
              pegMechanism: s.pegMechanism,
              circulating: s.circulating?.peggedUSD,
              price: s.price,
              chains: s.chains,
            }));

          return jsonResult({ count: stables.length, stablecoins: stables });
        } catch (e: any) {
          return errorResult(`Failed to fetch stablecoins: ${e.message}`);
        }
      },
    };
  }

  private dexVolumeTool(): ToolDefinition {
    return {
      name: "defi_dex_volume",
      description:
        "Get DEX trading volumes across protocols and chains. Shows 24h volume, changes, and top DEXes.",
      inputSchema: z.object({
        chain: z
          .string()
          .optional()
          .describe('Filter by chain (e.g. "Ethereum", "Solana"). Omit for all chains.'),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { chain } = input as { chain?: string };
          const url = chain
            ? `${LLAMA_API}/overview/dexs/${chain}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`
            : `${LLAMA_API}/overview/dexs?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`;
          const data = await fetchJson(url);

          const protocols = (data.protocols as any[] || [])
            .filter((p) => p.total24h > 0)
            .sort((a, b) => (b.total24h || 0) - (a.total24h || 0))
            .slice(0, 25)
            .map((p) => ({
              name: p.name,
              volume_24h: p.total24h,
              volume_7d: p.total7d,
              change_24h: p.change_1d ? `${p.change_1d.toFixed(2)}%` : null,
              chains: p.chains,
            }));

          return jsonResult({
            totalVolume24h: data.total24h,
            change_24h: data.change_1d,
            topDexes: protocols,
          });
        } catch (e: any) {
          return errorResult(`Failed to fetch DEX volumes: ${e.message}`);
        }
      },
    };
  }

  private protocolFeesTool(): ToolDefinition {
    return {
      name: "defi_protocol_fees",
      description:
        "Get protocol fees and revenue data across DeFi. Shows daily fees, revenue, and top earning protocols.",
      inputSchema: z.object({
        chain: z.string().optional().describe("Filter by chain. Omit for all."),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { chain } = input as { chain?: string };
          const url = chain
            ? `${LLAMA_API}/overview/fees/${chain}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`
            : `${LLAMA_API}/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`;
          const data = await fetchJson(url);

          const protocols = (data.protocols as any[] || [])
            .filter((p) => p.total24h > 0)
            .sort((a, b) => (b.total24h || 0) - (a.total24h || 0))
            .slice(0, 25)
            .map((p) => ({
              name: p.name,
              fees_24h: p.total24h,
              revenue_24h: p.revenue24h,
              change_24h: p.change_1d ? `${p.change_1d.toFixed(2)}%` : null,
              chains: p.chains,
              category: p.category,
            }));

          return jsonResult({
            totalFees24h: data.total24h,
            topProtocols: protocols,
          });
        } catch (e: any) {
          return errorResult(`Failed to fetch fees: ${e.message}`);
        }
      },
    };
  }

  private priceChartTool(): ToolDefinition {
    return {
      name: "defi_price_chart",
      description:
        'Get historical price chart data for a token. Uses DefiLlama coins API. Token format: "coingecko:ethereum" or "ethereum:0xAddress".',
      inputSchema: z.object({
        coin: z
          .string()
          .describe(
            'Token identifier. Format: "coingecko:id" (e.g. "coingecko:ethereum") or "chainName:tokenAddress" (e.g. "ethereum:0xdAC17F958D2ee523a2206206994597C13D831ec7")'
          ),
        period: z.string().optional().describe('Time period: "1d", "7d", "30d", "90d", "1y" (default "30d")'),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { coin, period = "30d" } = input as {
            coin: string; period?: string;
          };

          const periodMap: Record<string, { span: number; period: string }> = {
            "1d": { span: 24, period: "1h" },
            "7d": { span: 7, period: "1d" },
            "30d": { span: 30, period: "1d" },
            "90d": { span: 90, period: "1d" },
            "1y": { span: 365, period: "1d" },
          };

          const p = periodMap[period] || periodMap["30d"];
          const url = `${COINS_API}/chart/${encodeURIComponent(coin)}?span=${p.span}&period=${p.period}`;
          const data = await fetchJson(url);

          const coins = data.coins?.[coin];
          if (!coins) return errorResult(`No price data found for "${coin}"`);

          const prices = coins.prices.map((pt: any) => ({
            date: new Date(pt.timestamp * 1000).toISOString().split("T")[0],
            price: pt.price,
          }));

          return jsonResult({
            coin,
            symbol: coins.symbol,
            confidence: coins.confidence,
            period,
            dataPoints: prices.length,
            prices,
          });
        } catch (e: any) {
          return errorResult(`Failed to fetch price chart: ${e.message}`);
        }
      },
    };
  }

  private historicalPriceTool(): ToolDefinition {
    return {
      name: "defi_historical_price",
      description:
        'Get the price of a token at a specific point in time. Token format: "coingecko:id" or "chainName:0xAddress".',
      inputSchema: z.object({
        coin: z
          .string()
          .describe('Token identifier (e.g. "coingecko:ethereum", "ethereum:0xdAC17F958D2ee523a2206206994597C13D831ec7")'),
        timestamp: z
          .number()
          .describe("Unix timestamp (seconds) for the price lookup"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { coin, timestamp } = input as {
            coin: string; timestamp: number;
          };
          const url = `${COINS_API}/prices/historical/${timestamp}/${encodeURIComponent(coin)}`;
          const data = await fetchJson(url);

          const info = data.coins?.[coin];
          if (!info) return errorResult(`No price data found for "${coin}" at timestamp ${timestamp}`);

          return jsonResult({
            coin,
            symbol: info.symbol,
            price: info.price,
            timestamp: info.timestamp,
            date: new Date(info.timestamp * 1000).toISOString(),
            confidence: info.confidence,
          });
        } catch (e: any) {
          return errorResult(`Failed to fetch historical price: ${e.message}`);
        }
      },
    };
  }
}
