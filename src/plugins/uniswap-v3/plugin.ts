import { z } from "zod";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";
import { ChainIdSchema, AddressSchema } from "../../tools/schemas.js";

const UNISWAP_V3_SUBGRAPH: Record<string, string> = {
  ethereum:
    "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3",
  arbitrum:
    "https://api.thegraph.com/subgraphs/name/ianlapham/uniswap-arbitrum-one",
  polygon:
    "https://api.thegraph.com/subgraphs/name/ianlapham/uniswap-v3-polygon",
  optimism:
    "https://api.thegraph.com/subgraphs/name/ianlapham/optimism-post-regenesis",
  base: "https://api.thegraph.com/subgraphs/name/lynnshaoyu/uniswap-v3-base",
};

const NFT_POSITION_MANAGER: Record<string, string> = {
  ethereum: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
  arbitrum: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
  polygon: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
  optimism: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
  base: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1",
};

const SUPPORTED = Object.keys(UNISWAP_V3_SUBGRAPH);

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function errorResult(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }], isError: true };
}

async function subgraphQuery(chainId: string, query: string): Promise<any> {
  const url = UNISWAP_V3_SUBGRAPH[chainId];
  if (!url) throw new Error(`Uniswap V3 subgraph not available on "${chainId}"`);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Subgraph error: ${res.status}`);
  const data = await res.json();
  if (data.errors) throw new Error(data.errors[0].message);
  return data.data;
}

export class UniswapV3Plugin implements DefiPlugin {
  readonly name = "uniswap-v3";
  readonly description = "Uniswap V3: pools, positions, and liquidity management";
  readonly version = "1.0.0";

  async initialize(_ctx: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [
      this.poolsTool(),
      this.poolInfoTool(),
      this.positionsTool(),
      this.collectFeesTool(),
    ];
  }

  private poolsTool(): ToolDefinition {
    return {
      name: "defi_uniswap_pools",
      description: `Get top Uniswap V3 pools by TVL or volume. Supported chains: ${SUPPORTED.join(", ")}.`,
      inputSchema: z.object({
        chainId: ChainIdSchema,
        orderBy: z.enum(["totalValueLockedUSD", "volumeUSD"]).optional().describe("Sort by TVL or volume (default: TVL)"),
        limit: z.number().int().min(1).max(50).optional().describe("Number of results (default 20)"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { chainId, orderBy = "totalValueLockedUSD", limit = 20 } = input as {
            chainId: string; orderBy?: string; limit?: number;
          };

          const data = await subgraphQuery(chainId, `{
            pools(first: ${limit}, orderBy: ${orderBy}, orderDirection: desc,
                  where: { totalValueLockedUSD_gt: "10000" }) {
              id
              token0 { symbol name decimals id }
              token1 { symbol name decimals id }
              feeTier
              totalValueLockedUSD
              volumeUSD
              token0Price
              token1Price
              txCount
            }
          }`);

          const pools = (data.pools || []).map((p: any) => ({
            address: p.id,
            pair: `${p.token0.symbol}/${p.token1.symbol}`,
            feeTier: `${Number(p.feeTier) / 10000}%`,
            tvl: `$${Number(p.totalValueLockedUSD).toFixed(0)}`,
            volume: `$${Number(p.volumeUSD).toFixed(0)}`,
            price: `1 ${p.token0.symbol} = ${Number(p.token0Price).toFixed(6)} ${p.token1.symbol}`,
            txCount: p.txCount,
          }));

          return jsonResult({ chain: chainId, protocol: "Uniswap V3", count: pools.length, pools });
        } catch (e: any) {
          return errorResult(`Failed to fetch Uniswap V3 pools: ${e.message}`);
        }
      },
    };
  }

  private poolInfoTool(): ToolDefinition {
    return {
      name: "defi_uniswap_pool_info",
      description: `Get detailed info about a specific Uniswap V3 pool including price, TVL, volume, and tick data. Supported chains: ${SUPPORTED.join(", ")}.`,
      inputSchema: z.object({
        chainId: ChainIdSchema,
        poolAddress: AddressSchema.describe("Uniswap V3 pool contract address"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { chainId, poolAddress } = input as { chainId: string; poolAddress: string };
          const addr = poolAddress.toLowerCase();

          const data = await subgraphQuery(chainId, `{
            pool(id: "${addr}") {
              id
              token0 { symbol name decimals id }
              token1 { symbol name decimals id }
              feeTier
              liquidity
              sqrtPrice
              tick
              totalValueLockedUSD
              totalValueLockedToken0
              totalValueLockedToken1
              volumeUSD
              feesUSD
              token0Price
              token1Price
              txCount
              poolDayData(first: 7, orderBy: date, orderDirection: desc) {
                date
                volumeUSD
                feesUSD
                tvlUSD
              }
            }
          }`);

          if (!data.pool) return errorResult(`Pool ${poolAddress} not found on ${chainId}`);
          const p = data.pool;

          return jsonResult({
            chain: chainId,
            protocol: "Uniswap V3",
            pool: {
              address: p.id,
              pair: `${p.token0.symbol}/${p.token1.symbol}`,
              feeTier: `${Number(p.feeTier) / 10000}%`,
              token0: { symbol: p.token0.symbol, address: p.token0.id },
              token1: { symbol: p.token1.symbol, address: p.token1.id },
              price: `1 ${p.token0.symbol} = ${Number(p.token0Price).toFixed(6)} ${p.token1.symbol}`,
              tvl: `$${Number(p.totalValueLockedUSD).toFixed(0)}`,
              tvlToken0: `${Number(p.totalValueLockedToken0).toFixed(2)} ${p.token0.symbol}`,
              tvlToken1: `${Number(p.totalValueLockedToken1).toFixed(2)} ${p.token1.symbol}`,
              totalVolume: `$${Number(p.volumeUSD).toFixed(0)}`,
              totalFees: `$${Number(p.feesUSD).toFixed(0)}`,
              txCount: p.txCount,
              currentTick: p.tick,
              recentDays: (p.poolDayData || []).map((d: any) => ({
                date: new Date(d.date * 1000).toISOString().slice(0, 10),
                volume: `$${Number(d.volumeUSD).toFixed(0)}`,
                fees: `$${Number(d.feesUSD).toFixed(0)}`,
                tvl: `$${Number(d.tvlUSD).toFixed(0)}`,
              })),
            },
          });
        } catch (e: any) {
          return errorResult(`Failed to fetch pool info: ${e.message}`);
        }
      },
    };
  }

  private positionsTool(): ToolDefinition {
    return {
      name: "defi_uniswap_positions",
      description: `Get a user's Uniswap V3 LP positions with current value and fee earnings. Supported chains: ${SUPPORTED.join(", ")}.`,
      inputSchema: z.object({
        chainId: ChainIdSchema,
        userAddress: AddressSchema.describe("Wallet address to check"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { chainId, userAddress } = input as { chainId: string; userAddress: string };
          const addr = userAddress.toLowerCase();

          const data = await subgraphQuery(chainId, `{
            positions(where: { owner: "${addr}", liquidity_gt: "0" }, first: 50) {
              id
              pool {
                id
                token0 { symbol decimals id }
                token1 { symbol decimals id }
                feeTier
                token0Price
              }
              tickLower { tickIdx }
              tickUpper { tickIdx }
              liquidity
              depositedToken0
              depositedToken1
              withdrawnToken0
              withdrawnToken1
              collectedFeesToken0
              collectedFeesToken1
            }
          }`);

          const positions = (data.positions || []).map((p: any) => ({
            tokenId: p.id,
            pool: `${p.pool.token0.symbol}/${p.pool.token1.symbol}`,
            poolAddress: p.pool.id,
            feeTier: `${Number(p.pool.feeTier) / 10000}%`,
            tickRange: `${p.tickLower.tickIdx} to ${p.tickUpper.tickIdx}`,
            liquidity: p.liquidity,
            deposited: {
              token0: `${Number(p.depositedToken0).toFixed(6)} ${p.pool.token0.symbol}`,
              token1: `${Number(p.depositedToken1).toFixed(6)} ${p.pool.token1.symbol}`,
            },
            collectedFees: {
              token0: `${Number(p.collectedFeesToken0).toFixed(6)} ${p.pool.token0.symbol}`,
              token1: `${Number(p.collectedFeesToken1).toFixed(6)} ${p.pool.token1.symbol}`,
            },
          }));

          return jsonResult({
            chain: chainId,
            user: userAddress,
            protocol: "Uniswap V3",
            positionCount: positions.length,
            positions,
          });
        } catch (e: any) {
          return errorResult(`Failed to fetch positions: ${e.message}`);
        }
      },
    };
  }

  private collectFeesTool(): ToolDefinition {
    return {
      name: "defi_uniswap_collect_fees_tx",
      description: `Build an unsigned transaction to collect accumulated fees from a Uniswap V3 LP position. Supported chains: ${SUPPORTED.join(", ")}.`,
      inputSchema: z.object({
        chainId: ChainIdSchema,
        tokenId: z.string().describe("NFT position token ID"),
        userAddress: AddressSchema.describe("Wallet that owns the position"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { chainId, tokenId, userAddress } = input as {
            chainId: string; tokenId: string; userAddress: string;
          };

          const nftManager = NFT_POSITION_MANAGER[chainId];
          if (!nftManager) return errorResult(`Uniswap V3 not available on "${chainId}"`);

          const { encodeFunctionData, getAddress } = await import("viem");
          const collectAbi = [{
            name: "collect",
            type: "function" as const,
            stateMutability: "payable" as const,
            inputs: [{
              name: "params",
              type: "tuple",
              components: [
                { name: "tokenId", type: "uint256" },
                { name: "recipient", type: "address" },
                { name: "amount0Max", type: "uint128" },
                { name: "amount1Max", type: "uint128" },
              ],
            }],
            outputs: [
              { name: "amount0", type: "uint256" },
              { name: "amount1", type: "uint256" },
            ],
          }] as const;

          const MAX_UINT128 = (1n << 128n) - 1n;
          const data = encodeFunctionData({
            abi: collectAbi,
            functionName: "collect",
            args: [{
              tokenId: BigInt(tokenId),
              recipient: getAddress(userAddress),
              amount0Max: MAX_UINT128,
              amount1Max: MAX_UINT128,
            }],
          });

          return jsonResult({
            chainId,
            ecosystem: "evm",
            raw: {
              to: nftManager,
              data,
              value: "0x0",
              from: getAddress(userAddress),
            },
            description: `Collect all accumulated fees from Uniswap V3 position #${tokenId}`,
          });
        } catch (e: any) {
          return errorResult(`Failed to build collect tx: ${e.message}`);
        }
      },
    };
  }
}
