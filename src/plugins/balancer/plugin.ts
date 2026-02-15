import { z } from "zod";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";
import { ChainIdSchema } from "../../tools/schemas.js";

const BALANCER_API = "https://api-v3.balancer.fi";

const CHAIN_MAP: Record<string, string> = {
  ethereum: "MAINNET",
  arbitrum: "ARBITRUM",
  polygon: "POLYGON",
  optimism: "OPTIMISM",
  base: "BASE",
  avalanche: "AVALANCHE",
};

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function errorResult(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }], isError: true };
}

export class BalancerPlugin implements DefiPlugin {
  readonly name = "balancer";
  readonly description = "Balancer V2/V3: pool data, TVL, APR, and token composition";
  readonly version = "1.0.0";

  async initialize(_ctx: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [this.poolsTool()];
  }

  private poolsTool(): ToolDefinition {
    return {
      name: "defi_balancer_pools",
      description: `List Balancer pools with TVL, APR, volume, and token composition. Supported chains: ${Object.keys(CHAIN_MAP).join(", ")}.`,
      inputSchema: z.object({
        chainId: ChainIdSchema,
        limit: z.number().int().min(1).max(50).optional().describe("Number of results (default 20)"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { chainId, limit = 20 } = input as { chainId: string; limit?: number };
          const chain = CHAIN_MAP[chainId];
          if (!chain) return errorResult(`Balancer not available on "${chainId}". Supported: ${Object.keys(CHAIN_MAP).join(", ")}`);

          const query = `
            query {
              poolGetPools(
                first: ${limit},
                orderBy: totalLiquidity,
                orderDirection: desc,
                where: { chainIn: [${chain}], minTvl: 10000 }
              ) {
                id
                name
                address
                type
                dynamicData {
                  totalLiquidity
                  volume24h
                  apr {
                    total
                    items { title apr }
                  }
                  fees24h
                }
                allTokens {
                  symbol
                  address
                  weight
                }
              }
            }
          `;

          const res = await fetch(BALANCER_API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query }),
          });
          if (!res.ok) throw new Error(`Balancer API ${res.status}`);
          const data = await res.json();

          if (data.errors) throw new Error(data.errors[0].message);

          const pools = (data.data?.poolGetPools || []).map((p: any) => ({
            name: p.name,
            address: p.address,
            type: p.type,
            tvl: Number(p.dynamicData?.totalLiquidity) || 0,
            volume24h: Number(p.dynamicData?.volume24h) || 0,
            fees24h: Number(p.dynamicData?.fees24h) || 0,
            apr: p.dynamicData?.apr?.total != null
              ? `${(Number(p.dynamicData.apr.total) * 100).toFixed(2)}%`
              : "N/A",
            tokens: p.allTokens?.map((t: any) => ({
              symbol: t.symbol,
              address: t.address,
              weight: t.weight ? `${(Number(t.weight) * 100).toFixed(0)}%` : undefined,
            })),
          }));

          return jsonResult({ chain: chainId, count: pools.length, pools });
        } catch (e: any) {
          return errorResult(`Failed to fetch Balancer pools: ${e.message}`);
        }
      },
    };
  }
}
