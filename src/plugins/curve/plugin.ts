import { z } from "zod";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";
import { ChainIdSchema } from "../../tools/schemas.js";

const CURVE_API = "https://api.curve.fi/v1";

const CHAIN_MAP: Record<string, string> = {
  ethereum: "ethereum",
  arbitrum: "arbitrum",
  optimism: "optimism",
  polygon: "polygon",
  base: "base",
  avalanche: "avalanche",
};

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function errorResult(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }], isError: true };
}

export class CurvePlugin implements DefiPlugin {
  readonly name = "curve";
  readonly description = "Curve Finance: pool data, APYs, and liquidity across chains";
  readonly version = "1.0.0";

  async initialize(_ctx: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [this.poolsTool(), this.poolInfoTool()];
  }

  private poolsTool(): ToolDefinition {
    return {
      name: "defi_curve_pools",
      description: `List Curve pools with APY, TVL, volume, and token composition. Supported chains: ${Object.keys(CHAIN_MAP).join(", ")}.`,
      inputSchema: z.object({
        chainId: ChainIdSchema,
        limit: z.number().int().min(1).max(50).optional().describe("Number of results (default 20)"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { chainId, limit = 20 } = input as { chainId: string; limit?: number };
          const chain = CHAIN_MAP[chainId];
          if (!chain) return errorResult(`Curve not available on "${chainId}". Supported: ${Object.keys(CHAIN_MAP).join(", ")}`);

          const res = await fetch(`${CURVE_API}/getPools/all/${chain}`);
          if (!res.ok) throw new Error(`Curve API ${res.status}`);
          const data = await res.json();

          if (!data.success) throw new Error("Curve API returned error");

          const pools = (data.data?.poolData || [])
            .filter((p: any) => p.usdTotal > 1000)
            .sort((a: any, b: any) => (b.usdTotal || 0) - (a.usdTotal || 0))
            .slice(0, limit)
            .map((p: any) => ({
              name: p.name,
              address: p.address,
              tvl: p.usdTotal,
              volume24h: p.usdVolume,
              coins: p.coins?.map((c: any) => c.symbol),
              apy: p.gaugeCrvApy?.[0] != null
                ? `${(p.gaugeCrvApy[0] + (p.gaugeCrvApy[1] || 0)).toFixed(2)}%`
                : "N/A",
            }));

          return jsonResult({ chain: chainId, count: pools.length, pools });
        } catch (e: any) {
          return errorResult(`Failed to fetch Curve pools: ${e.message}`);
        }
      },
    };
  }

  private poolInfoTool(): ToolDefinition {
    return {
      name: "defi_curve_pool_info",
      description: "Get detailed info for a specific Curve pool including tokens, balances, fees, and APY breakdown.",
      inputSchema: z.object({
        chainId: ChainIdSchema,
        poolAddress: z.string().describe("Curve pool contract address"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { chainId, poolAddress } = input as { chainId: string; poolAddress: string };
          const chain = CHAIN_MAP[chainId];
          if (!chain) return errorResult(`Curve not available on "${chainId}"`);

          const res = await fetch(`${CURVE_API}/getPools/all/${chain}`);
          if (!res.ok) throw new Error(`Curve API ${res.status}`);
          const data = await res.json();

          const pool = (data.data?.poolData || []).find(
            (p: any) => p.address?.toLowerCase() === poolAddress.toLowerCase()
          );

          if (!pool) return errorResult(`Pool ${poolAddress} not found on ${chainId}`);

          return jsonResult({
            name: pool.name,
            address: pool.address,
            chain: chainId,
            tvl: pool.usdTotal,
            volume24h: pool.usdVolume,
            fee: pool.fee ? `${(Number(pool.fee) / 1e8).toFixed(4)}%` : undefined,
            virtualPrice: pool.virtualPrice,
            coins: pool.coins?.map((c: any) => ({
              symbol: c.symbol,
              address: c.address,
              decimals: c.decimals,
              balance: c.poolBalance,
              usdPrice: c.usdPrice,
            })),
            apy: {
              base: pool.gaugeCrvApy?.[0],
              crv: pool.gaugeCrvApy?.[1],
            },
            gaugeAddress: pool.gaugeAddress,
          });
        } catch (e: any) {
          return errorResult(`Failed to fetch pool info: ${e.message}`);
        }
      },
    };
  }
}
