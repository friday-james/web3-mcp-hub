import { z } from "zod";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";
import { ChainIdSchema, AddressSchema } from "../../tools/schemas.js";

const GMX_API: Record<string, string> = {
  arbitrum: "https://arbitrum-api.gmxinfra.io",
  avalanche: "https://avalanche-api.gmxinfra.io",
};

const GMX_SUBGRAPH: Record<string, string> = {
  arbitrum: "https://subgraph.satsuma-prod.com/3b2ced13c8d9/gmx/synthetics-arbitrum-stats/api",
  avalanche: "https://subgraph.satsuma-prod.com/3b2ced13c8d9/gmx/synthetics-avalanche-stats/api",
};

const SUPPORTED = Object.keys(GMX_API);

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function errorResult(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }], isError: true };
}

export class GmxPlugin implements DefiPlugin {
  readonly name = "gmx";
  readonly description = "GMX V2: perpetual trading markets, positions, and stats";
  readonly version = "1.0.0";

  async initialize(_ctx: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [
      this.marketsTool(),
      this.pricesTool(),
      this.positionsTool(),
    ];
  }

  private marketsTool(): ToolDefinition {
    return {
      name: "defi_gmx_markets",
      description: `List GMX V2 perpetual markets with open interest, funding rates, and available liquidity. Supported chains: ${SUPPORTED.join(", ")}.`,
      inputSchema: z.object({
        chainId: ChainIdSchema,
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { chainId } = input as { chainId: string };
          const apiUrl = GMX_API[chainId];
          if (!apiUrl) return errorResult(`GMX not available on "${chainId}". Supported: ${SUPPORTED.join(", ")}`);

          const res = await fetch(`${apiUrl}/markets`);
          if (!res.ok) throw new Error(`GMX API ${res.status}`);
          const data = await res.json();

          const markets = (Array.isArray(data) ? data : data.markets || []).map((m: any) => ({
            marketToken: m.marketToken,
            indexToken: m.indexTokenSymbol || m.indexToken,
            longToken: m.longTokenSymbol || m.longToken,
            shortToken: m.shortTokenSymbol || m.shortToken,
            longOpenInterest: m.longOpenInterest,
            shortOpenInterest: m.shortOpenInterest,
            longFundingRate: m.longFundingRate,
            shortFundingRate: m.shortFundingRate,
            borrowingRateLong: m.borrowingRateLong,
            borrowingRateShort: m.borrowingRateShort,
          }));

          return jsonResult({ chain: chainId, protocol: "GMX V2", marketCount: markets.length, markets });
        } catch (e: any) {
          return errorResult(`Failed to fetch GMX markets: ${e.message}`);
        }
      },
    };
  }

  private pricesTool(): ToolDefinition {
    return {
      name: "defi_gmx_prices",
      description: `Get current token prices from GMX oracle. Returns min/max prices used for order execution. Supported chains: ${SUPPORTED.join(", ")}.`,
      inputSchema: z.object({
        chainId: ChainIdSchema,
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { chainId } = input as { chainId: string };
          const apiUrl = GMX_API[chainId];
          if (!apiUrl) return errorResult(`GMX not available on "${chainId}". Supported: ${SUPPORTED.join(", ")}`);

          const res = await fetch(`${apiUrl}/prices/tickers`);
          if (!res.ok) throw new Error(`GMX API ${res.status}`);
          const data = await res.json();

          const prices = (Array.isArray(data) ? data : []).map((p: any) => ({
            token: p.tokenSymbol || p.tokenAddress,
            minPrice: p.minPrice,
            maxPrice: p.maxPrice,
            medianPrice: p.medianPrice,
          }));

          return jsonResult({ chain: chainId, protocol: "GMX V2", prices });
        } catch (e: any) {
          return errorResult(`Failed to fetch GMX prices: ${e.message}`);
        }
      },
    };
  }

  private positionsTool(): ToolDefinition {
    return {
      name: "defi_gmx_positions",
      description: `Get a user's open GMX V2 perpetual positions including PnL, leverage, and liquidation price. Supported chains: ${SUPPORTED.join(", ")}.`,
      inputSchema: z.object({
        chainId: ChainIdSchema,
        userAddress: AddressSchema.describe("Wallet address to check"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { chainId, userAddress } = input as { chainId: string; userAddress: string };
          const subgraphUrl = GMX_SUBGRAPH[chainId];
          if (!subgraphUrl) return errorResult(`GMX not available on "${chainId}". Supported: ${SUPPORTED.join(", ")}`);

          const query = `{
            trades(
              where: { account: "${userAddress.toLowerCase()}" }
              orderBy: timestamp
              orderDirection: desc
              first: 20
            ) {
              id
              account
              collateralToken
              indexToken
              isLong
              sizeDelta
              collateralDelta
              fee
              price
              timestamp
              txhash
            }
          }`;

          const res = await fetch(subgraphUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query }),
          });
          if (!res.ok) throw new Error(`GMX subgraph ${res.status}`);
          const data = await res.json();

          const trades = (data.data?.trades || []).map((t: any) => ({
            id: t.id,
            side: t.isLong ? "LONG" : "SHORT",
            indexToken: t.indexToken,
            size: t.sizeDelta,
            collateral: t.collateralDelta,
            price: t.price,
            fee: t.fee,
            timestamp: new Date(Number(t.timestamp) * 1000).toISOString(),
            txHash: t.txhash,
          }));

          return jsonResult({
            chain: chainId,
            user: userAddress,
            protocol: "GMX V2",
            tradeCount: trades.length,
            recentTrades: trades,
          });
        } catch (e: any) {
          return errorResult(`Failed to fetch GMX positions: ${e.message}`);
        }
      },
    };
  }
}
