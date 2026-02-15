import { z } from "zod";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";
import { ChainIdSchema } from "../../tools/schemas.js";

const PENDLE_API = "https://api-v2.pendle.finance/core";

const CHAIN_MAP: Record<string, number> = {
  ethereum: 1,
  arbitrum: 42161,
  optimism: 10,
  base: 8453,
};

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function errorResult(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }], isError: true };
}

export class PendlePlugin implements DefiPlugin {
  readonly name = "pendle";
  readonly description = "Pendle Finance: yield trading markets, PT/YT prices, fixed yield opportunities";
  readonly version = "1.0.0";

  async initialize(_ctx: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [this.marketsTool(), this.assetsTool()];
  }

  private marketsTool(): ToolDefinition {
    return {
      name: "defi_pendle_markets",
      description: `List Pendle yield trading markets with implied APY, underlying APY, maturity, TVL. Buy PT for fixed yield, buy YT for leveraged yield exposure. Supported chains: ${Object.keys(CHAIN_MAP).join(", ")}.`,
      inputSchema: z.object({
        chainId: ChainIdSchema.optional().describe("Filter by chain. Omit for all chains."),
        limit: z.number().int().min(1).max(50).optional().describe("Number of results (default 20)"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { chainId, limit = 20 } = input as { chainId?: string; limit?: number };

          let url = `${PENDLE_API}/v1/sdk/markets?limit=${limit}&order_by=tvl&is_expired=false`;
          if (chainId) {
            const numericId = CHAIN_MAP[chainId];
            if (!numericId) return errorResult(`Pendle not available on "${chainId}". Supported: ${Object.keys(CHAIN_MAP).join(", ")}`);
            url += `&chain_id=${numericId}`;
          }

          const res = await fetch(url);
          if (!res.ok) {
            // Fallback to the free markets endpoint
            const fallbackRes = await fetch(`${PENDLE_API}/v1/sdk/markets/all`);
            if (!fallbackRes.ok) throw new Error(`Pendle API ${fallbackRes.status}`);
            const allData = await fallbackRes.json();

            let markets = (allData.results || allData || []) as any[];
            if (chainId) {
              const numericId = CHAIN_MAP[chainId];
              markets = markets.filter((m: any) => m.chainId === numericId);
            }

            markets = markets
              .filter((m: any) => !m.isExpired)
              .sort((a: any, b: any) => (b.liquidity?.usd || b.tvl || 0) - (a.liquidity?.usd || a.tvl || 0))
              .slice(0, limit)
              .map((m: any) => ({
                name: m.name || m.proName,
                address: m.address,
                chainId: m.chainId,
                expiry: m.expiry,
                ptAddress: m.pt?.address,
                ytAddress: m.yt?.address,
                underlyingApy: m.underlyingApy != null ? `${(m.underlyingApy * 100).toFixed(2)}%` : undefined,
                impliedApy: m.impliedApy != null ? `${(m.impliedApy * 100).toFixed(2)}%` : undefined,
                tvl: m.liquidity?.usd || m.tvl,
              }));

            return jsonResult({ count: markets.length, markets });
          }

          const data = await res.json();
          const markets = ((data.results || data) as any[])
            .slice(0, limit)
            .map((m: any) => ({
              name: m.name || m.proName,
              address: m.address,
              chainId: m.chainId,
              expiry: m.expiry,
              ptAddress: m.pt?.address,
              ytAddress: m.yt?.address,
              underlyingApy: m.underlyingApy != null ? `${(m.underlyingApy * 100).toFixed(2)}%` : undefined,
              impliedApy: m.impliedApy != null ? `${(m.impliedApy * 100).toFixed(2)}%` : undefined,
              tvl: m.liquidity?.usd || m.tvl,
            }));

          return jsonResult({ count: markets.length, markets });
        } catch (e: any) {
          return errorResult(`Failed to fetch Pendle markets: ${e.message}`);
        }
      },
    };
  }

  private assetsTool(): ToolDefinition {
    return {
      name: "defi_pendle_assets",
      description: "List all Pendle PT, YT, and SY assets with current prices.",
      inputSchema: z.object({
        chainId: ChainIdSchema.optional().describe("Filter by chain. Omit for all."),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { chainId } = input as { chainId?: string };

          const res = await fetch(`${PENDLE_API}/v1/sdk/assets/all`);
          if (!res.ok) throw new Error(`Pendle API ${res.status}`);
          const data = await res.json();

          let assets = (data.results || data || []) as any[];

          if (chainId) {
            const numericId = CHAIN_MAP[chainId];
            if (!numericId) return errorResult(`Pendle not available on "${chainId}"`);
            assets = assets.filter((a: any) => a.chainId === numericId);
          }

          const formatted = assets.slice(0, 50).map((a: any) => ({
            name: a.name,
            symbol: a.symbol,
            address: a.address,
            chainId: a.chainId,
            type: a.type, // PT, YT, SY, LP
            price: a.price?.usd,
            expiry: a.expiry,
          }));

          return jsonResult({ count: formatted.length, assets: formatted });
        } catch (e: any) {
          return errorResult(`Failed to fetch Pendle assets: ${e.message}`);
        }
      },
    };
  }
}
