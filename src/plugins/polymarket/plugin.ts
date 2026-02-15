import { z } from "zod";
import { encodeFunctionData, parseUnits } from "viem";
import { BasePlugin } from "../../core/base-plugin.js";
import type { ToolDefinition, PluginContext, ToolResult } from "../../core/types.js";
import { AddressSchema, AmountSchema } from "../../tools/schemas.js";
import {
  GAMMA_API,
  CLOB_API,
  DATA_API,
  CTF_ADDRESS,
  USDC_E_ADDRESS,
  USDC_E_DECIMALS,
  POLYMARKET_CHAIN_ID,
} from "./addresses.js";
import { CTF_ABI } from "./abi.js";

export class PolymarketPlugin extends BasePlugin {
  readonly name = "polymarket";
  readonly description =
    "Polymarket prediction markets: browse markets, view positions, get quotes, and build transactions";
  readonly version = "1.0.0";

  getTools(): ToolDefinition[] {
    return [
      {
        name: "defi_polymarket_markets",
        description:
          "List active Polymarket prediction markets with current odds, volume, and end dates. Optionally filter by search query.",
        inputSchema: z.object({
          query: z
            .string()
            .optional()
            .describe("Search query to filter markets (e.g. 'bitcoin', 'election')"),
          limit: z
            .number()
            .int()
            .min(1)
            .max(50)
            .optional()
            .describe("Number of events to return (default 10)"),
        }),
        handler: async (input: unknown): Promise<ToolResult> => {
          const { query, limit = 10 } = input as {
            query?: string;
            limit?: number;
          };

          const params = new URLSearchParams({
            active: "true",
            closed: "false",
            limit: limit.toString(),
            order: "volume",
            ascending: "false",
          });
          if (query) params.set("tag", query);

          const res = await fetch(`${GAMMA_API}/events?${params}`);
          if (!res.ok) throw new Error(`Gamma API error: ${res.status}`);
          const events = await res.json();

          const results = events.map((event: any) => ({
            id: event.id,
            title: event.title,
            slug: event.slug,
            endDate: event.endDate,
            active: event.active,
            volume: event.volume,
            liquidity: event.liquidity,
            markets: (event.markets || []).map((m: any) => ({
              id: m.id,
              question: m.question,
              conditionId: m.conditionId,
              outcomes: m.outcomes,
              outcomePrices: m.outcomePrices,
              clobTokenIds: m.clobTokenIds,
              volume: m.volume,
              liquidity: m.liquidity,
              active: m.active,
            })),
          }));

          return this.jsonResult(results);
        },
      },
      {
        name: "defi_polymarket_positions",
        description:
          "Get a wallet's Polymarket positions including market title, outcome, size, entry price, and P&L.",
        inputSchema: z.object({
          address: AddressSchema.describe("Wallet address to check positions for"),
        }),
        handler: async (input: unknown): Promise<ToolResult> => {
          const { address } = input as { address: string };

          const res = await fetch(
            `${DATA_API}/positions?user=${address.toLowerCase()}`
          );
          if (!res.ok) throw new Error(`Data API error: ${res.status}`);
          const positions = await res.json();

          if (!Array.isArray(positions) || positions.length === 0) {
            return this.jsonResult({
              address,
              positions: [],
              message: "No Polymarket positions found for this address",
            });
          }

          const results = positions.map((p: any) => ({
            market: p.title || p.market?.question,
            outcome: p.outcome,
            size: p.size,
            avgPrice: p.avgPrice,
            currentPrice: p.curPrice,
            initialValue: p.initialValue,
            currentValue: p.currentValue,
            cashPnl: p.cashPnl,
            percentPnl: p.percentPnl,
            asset: p.asset,
          }));

          return this.jsonResult({ address, positions: results });
        },
      },
      {
        name: "defi_polymarket_quote",
        description:
          "Get the current price for a Polymarket outcome token. Returns price per share (0-1) representing probability.",
        inputSchema: z.object({
          tokenId: z
            .string()
            .describe("Outcome token ID (from defi_polymarket_markets clobTokenIds)"),
          side: z.enum(["BUY", "SELL"]).describe("Whether to buy or sell the outcome token"),
        }),
        handler: async (input: unknown): Promise<ToolResult> => {
          const { tokenId, side } = input as {
            tokenId: string;
            side: "BUY" | "SELL";
          };

          const res = await fetch(
            `${CLOB_API}/price?token_id=${tokenId}&side=${side}`
          );
          if (!res.ok) throw new Error(`CLOB API error: ${res.status}`);
          const data = await res.json();

          return this.jsonResult({
            tokenId,
            side,
            price: data.price,
            impliedProbability: `${(parseFloat(data.price) * 100).toFixed(1)}%`,
          });
        },
      },
      {
        name: "defi_polymarket_build_tx",
        description:
          "Build an unsigned transaction to split USDC into YES and NO outcome tokens on Polymarket. This converts USDC into equal amounts of YES and NO tokens for a market. You can then sell the unwanted side.",
        inputSchema: z.object({
          conditionId: z
            .string()
            .describe("Market condition ID (from defi_polymarket_markets)"),
          amount: AmountSchema.describe("Amount of USDC to split"),
          userAddress: AddressSchema.describe("Wallet address that will sign the transaction"),
        }),
        handler: async (input: unknown): Promise<ToolResult> => {
          const { conditionId, amount, userAddress } = input as {
            conditionId: string;
            amount: string;
            userAddress: string;
          };

          const rawAmount = parseUnits(amount, USDC_E_DECIMALS);

          const data = encodeFunctionData({
            abi: CTF_ABI,
            functionName: "splitPosition",
            args: [
              USDC_E_ADDRESS,
              "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
              conditionId as `0x${string}`,
              [1n, 2n],
              rawAmount,
            ],
          });

          return this.jsonResult({
            chainId: POLYMARKET_CHAIN_ID,
            ecosystem: "evm",
            description: `Split ${amount} USDC into YES and NO tokens for condition ${conditionId.slice(0, 10)}...`,
            raw: {
              to: CTF_ADDRESS,
              data,
              value: "0x0",
              chainId: 137,
            },
            note: `Make sure USDC.e (${USDC_E_ADDRESS}) is approved for ${CTF_ADDRESS} first (use defi_token_approve)`,
          });
        },
      },
    ];
  }
}
