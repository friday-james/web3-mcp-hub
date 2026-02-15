import { z } from "zod";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";

const MORPHO_GQL = "https://blue-api.morpho.org/graphql";

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function errorResult(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }], isError: true };
}

async function gqlQuery(query: string, variables: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(MORPHO_GQL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Morpho API ${res.status}`);
  const data = await res.json();
  if (data.errors) throw new Error(data.errors[0].message);
  return data.data;
}

export class MorphoPlugin implements DefiPlugin {
  readonly name = "morpho";
  readonly description = "Morpho Blue: optimized lending markets with higher yields and better rates";
  readonly version = "1.0.0";

  async initialize(_ctx: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [this.marketsTool(), this.vaultsTool(), this.positionTool()];
  }

  private marketsTool(): ToolDefinition {
    return {
      name: "defi_morpho_markets",
      description:
        "List Morpho Blue lending markets with supply APY, borrow APY, TVL, and utilization. Shows markets with better rates than Aave/Compound.",
      inputSchema: z.object({
        chainId: z.number().optional().describe("Filter by chain ID (1=Ethereum, 8453=Base). Omit for all."),
        limit: z.number().int().min(1).max(50).optional().describe("Number of results (default 20)"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { chainId, limit = 20 } = input as { chainId?: number; limit?: number };

          const where = chainId ? `where: { chainId_in: [${chainId}] }` : "";

          const query = `
            query {
              markets(first: ${limit}, orderBy: SupplyAssetsUsd, orderDirection: Desc, ${where}) {
                items {
                  uniqueKey
                  loanAsset { symbol address decimals }
                  collateralAsset { symbol address decimals }
                  state {
                    supplyApy
                    borrowApy
                    supplyAssetsUsd
                    borrowAssetsUsd
                    utilization
                    liquidityAssetsUsd
                  }
                  lltv
                  oracleAddress
                }
              }
            }
          `;

          const data = await gqlQuery(query);
          const markets = (data.markets?.items || []).map((m: any) => ({
            id: m.uniqueKey,
            loanAsset: m.loanAsset?.symbol,
            loanAssetAddress: m.loanAsset?.address,
            collateralAsset: m.collateralAsset?.symbol,
            collateralAssetAddress: m.collateralAsset?.address,
            supplyApy: m.state?.supplyApy != null ? `${(m.state.supplyApy * 100).toFixed(2)}%` : "N/A",
            borrowApy: m.state?.borrowApy != null ? `${(m.state.borrowApy * 100).toFixed(2)}%` : "N/A",
            supplyTvl: m.state?.supplyAssetsUsd,
            borrowTvl: m.state?.borrowAssetsUsd,
            utilization: m.state?.utilization != null ? `${(m.state.utilization * 100).toFixed(1)}%` : "N/A",
            availableLiquidity: m.state?.liquidityAssetsUsd,
            lltv: m.lltv != null ? `${(Number(m.lltv) * 100).toFixed(0)}%` : undefined,
          }));

          return jsonResult({ count: markets.length, markets });
        } catch (e: any) {
          return errorResult(`Failed to fetch Morpho markets: ${e.message}`);
        }
      },
    };
  }

  private vaultsTool(): ToolDefinition {
    return {
      name: "defi_morpho_vaults",
      description:
        "List Morpho vaults (curated lending strategies) with APY and TVL. Vaults auto-allocate across Morpho Blue markets for optimized yield.",
      inputSchema: z.object({
        chainId: z.number().optional().describe("Filter by chain ID"),
        limit: z.number().int().min(1).max(50).optional().describe("Number of results (default 20)"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { chainId, limit = 20 } = input as { chainId?: number; limit?: number };
          const where = chainId ? `where: { chainId_in: [${chainId}] }` : "";

          const query = `
            query {
              vaults(first: ${limit}, orderBy: TotalAssetsUsd, orderDirection: Desc, ${where}) {
                items {
                  address
                  name
                  symbol
                  asset { symbol address decimals }
                  chain { id }
                  state {
                    totalAssetsUsd
                    apy
                    netApy
                    curator
                    fee
                  }
                }
              }
            }
          `;

          const data = await gqlQuery(query);
          const vaults = (data.vaults?.items || []).map((v: any) => ({
            name: v.name,
            symbol: v.symbol,
            address: v.address,
            chain: v.chain?.id,
            underlyingAsset: v.asset?.symbol,
            underlyingAddress: v.asset?.address,
            apy: v.state?.netApy != null ? `${(v.state.netApy * 100).toFixed(2)}%` : "N/A",
            tvl: v.state?.totalAssetsUsd,
            curator: v.state?.curator,
            fee: v.state?.fee != null ? `${(v.state.fee * 100).toFixed(1)}%` : undefined,
          }));

          return jsonResult({ count: vaults.length, vaults });
        } catch (e: any) {
          return errorResult(`Failed to fetch Morpho vaults: ${e.message}`);
        }
      },
    };
  }

  private positionTool(): ToolDefinition {
    return {
      name: "defi_morpho_positions",
      description: "Get a user's Morpho Blue positions across all markets.",
      inputSchema: z.object({
        userAddress: z.string().describe("Wallet address to check"),
        chainId: z.number().optional().describe("Filter by chain ID"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { userAddress, chainId } = input as { userAddress: string; chainId?: number };
          const where = chainId
            ? `where: { userAddress: "${userAddress.toLowerCase()}", chainId_in: [${chainId}] }`
            : `where: { userAddress: "${userAddress.toLowerCase()}" }`;

          const query = `
            query {
              marketPositions(first: 50, ${where}) {
                items {
                  market {
                    uniqueKey
                    loanAsset { symbol }
                    collateralAsset { symbol }
                    state { supplyApy borrowApy }
                  }
                  state {
                    supplyAssetsUsd
                    borrowAssetsUsd
                    collateralUsd
                  }
                }
              }
            }
          `;

          const data = await gqlQuery(query);
          const positions = (data.marketPositions?.items || [])
            .filter((p: any) =>
              (p.state?.supplyAssetsUsd || 0) > 0.01 ||
              (p.state?.borrowAssetsUsd || 0) > 0.01
            )
            .map((p: any) => ({
              marketId: p.market?.uniqueKey,
              loanAsset: p.market?.loanAsset?.symbol,
              collateralAsset: p.market?.collateralAsset?.symbol,
              supplyUsd: p.state?.supplyAssetsUsd,
              borrowUsd: p.state?.borrowAssetsUsd,
              collateralUsd: p.state?.collateralUsd,
              supplyApy: p.market?.state?.supplyApy != null
                ? `${(p.market.state.supplyApy * 100).toFixed(2)}%` : undefined,
              borrowApy: p.market?.state?.borrowApy != null
                ? `${(p.market.state.borrowApy * 100).toFixed(2)}%` : undefined,
            }));

          return jsonResult({
            user: userAddress,
            positionCount: positions.length,
            positions,
          });
        } catch (e: any) {
          return errorResult(`Failed to fetch Morpho positions: ${e.message}`);
        }
      },
    };
  }
}
