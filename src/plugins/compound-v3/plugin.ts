import { z } from "zod";
import {
  createPublicClient,
  http,
  getAddress,
  encodeFunctionData,
  formatUnits,
  maxUint256,
} from "viem";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";
import { ChainIdSchema, AddressSchema, AmountSchema } from "../../tools/schemas.js";
import { parseTokenAmount } from "../../core/utils.js";
import {
  COMPOUND_V3_MARKETS,
  getSupportedCompoundV3Chains,
} from "./addresses.js";
import { COMET_ABI, rateToApr } from "./abi.js";

const SUPPORTED = getSupportedCompoundV3Chains();

export class CompoundV3Plugin implements DefiPlugin {
  readonly name = "compound-v3";
  readonly description =
    "Compound V3 lending: markets, positions, supply and withdraw";
  readonly version = "1.0.0";

  async initialize(_context: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [
      this.marketsTool(),
      this.positionTool(),
      this.supplyTxTool(),
      this.withdrawTxTool(),
    ];
  }

  private marketsTool(): ToolDefinition {
    return {
      name: "defi_compound_markets",
      description: `List Compound V3 markets with supply APY, borrow APY, utilization, and TVL. Supported chains: ${SUPPORTED.join(", ")}.`,
      inputSchema: z.object({}),
      handler: async (_input: unknown, context: PluginContext): Promise<ToolResult> => {
        try {
          const results = await Promise.all(
            SUPPORTED.map(async (chainId) => {
              const market = COMPOUND_V3_MARKETS[chainId];
              if (!market) return null;
              const chain = context.getChainAdapterForChain(chainId).getChain(chainId);
              if (!chain) return null;
              const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
              const client = createPublicClient({ transport: http(rpcUrl) });

              try {
                const [utilization, totalSupply, totalBorrow] = await Promise.all([
                  client.readContract({ address: market.comet, abi: COMET_ABI, functionName: "getUtilization" }),
                  client.readContract({ address: market.comet, abi: COMET_ABI, functionName: "totalSupply" }),
                  client.readContract({ address: market.comet, abi: COMET_ABI, functionName: "totalBorrow" }),
                ]);
                const [supplyRate, borrowRate] = await Promise.all([
                  client.readContract({ address: market.comet, abi: COMET_ABI, functionName: "getSupplyRate", args: [utilization] }),
                  client.readContract({ address: market.comet, abi: COMET_ABI, functionName: "getBorrowRate", args: [utilization] }),
                ]);

                return {
                  chain: chain.name,
                  chainId,
                  baseToken: market.baseToken,
                  comet: market.comet,
                  supplyApy: `${rateToApr(supplyRate).toFixed(2)}%`,
                  borrowApy: `${rateToApr(borrowRate).toFixed(2)}%`,
                  totalSupply: `${Number(formatUnits(totalSupply, market.baseTokenDecimals)).toFixed(0)} ${market.baseToken}`,
                  totalBorrow: `${Number(formatUnits(totalBorrow, market.baseTokenDecimals)).toFixed(0)} ${market.baseToken}`,
                  utilization: `${(Number(utilization) / 1e18 * 100).toFixed(1)}%`,
                };
              } catch { return null; }
            })
          );

          const markets = results.filter(Boolean);
          return {
            content: [{ type: "text", text: JSON.stringify({ protocol: "Compound V3", marketsCount: markets.length, markets }, null, 2) }],
          };
        } catch (e: any) {
          return { content: [{ type: "text", text: `Failed to fetch Compound V3 markets: ${e.message}` }], isError: true };
        }
      },
    };
  }

  private positionTool(): ToolDefinition {
    return {
      name: "defi_compound_position",
      description: `Get a user's Compound V3 position: supply balance, borrow balance, and current rates. Supported chains: ${SUPPORTED.join(", ")}.`,
      inputSchema: z.object({
        chainId: ChainIdSchema,
        userAddress: AddressSchema.describe("User wallet address"),
      }),
      handler: async (input: unknown, context: PluginContext): Promise<ToolResult> => {
        const { chainId, userAddress } = input as { chainId: string; userAddress: string };
        const market = COMPOUND_V3_MARKETS[chainId];
        if (!market) return { content: [{ type: "text", text: `Compound V3 not available on "${chainId}"` }], isError: true };

        const chain = context.getChainAdapterForChain(chainId).getChain(chainId);
        if (!chain) return { content: [{ type: "text", text: `Chain "${chainId}" not found` }], isError: true };

        const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
        const client = createPublicClient({ transport: http(rpcUrl) });
        const user = getAddress(userAddress);

        try {
          const [supplyBal, borrowBal, utilization] = await Promise.all([
            client.readContract({ address: market.comet, abi: COMET_ABI, functionName: "balanceOf", args: [user] }),
            client.readContract({ address: market.comet, abi: COMET_ABI, functionName: "borrowBalanceOf", args: [user] }),
            client.readContract({ address: market.comet, abi: COMET_ABI, functionName: "getUtilization" }),
          ]);
          const [supplyRate, borrowRate] = await Promise.all([
            client.readContract({ address: market.comet, abi: COMET_ABI, functionName: "getSupplyRate", args: [utilization] }),
            client.readContract({ address: market.comet, abi: COMET_ABI, functionName: "getBorrowRate", args: [utilization] }),
          ]);

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                chain: chain.name,
                protocol: "Compound V3",
                user: userAddress,
                baseToken: market.baseToken,
                supplyBalance: `${Number(formatUnits(supplyBal, market.baseTokenDecimals)).toFixed(6)} ${market.baseToken}`,
                borrowBalance: `${Number(formatUnits(borrowBal, market.baseTokenDecimals)).toFixed(6)} ${market.baseToken}`,
                supplyApy: `${rateToApr(supplyRate).toFixed(2)}%`,
                borrowApy: `${rateToApr(borrowRate).toFixed(2)}%`,
              }, null, 2),
            }],
          };
        } catch (e: any) {
          return { content: [{ type: "text", text: `Failed to fetch position: ${e.message}` }], isError: true };
        }
      },
    };
  }

  private supplyTxTool(): ToolDefinition {
    return {
      name: "defi_compound_supply_tx",
      description: `Build an unsigned transaction to supply the base asset into Compound V3. The base asset must be approved for the Comet contract first (use defi_token_approve). Supported chains: ${SUPPORTED.join(", ")}.`,
      inputSchema: z.object({
        chainId: ChainIdSchema,
        amount: AmountSchema,
        userAddress: AddressSchema.describe(
          "Wallet address that will sign and send this transaction"
        ),
      }),
      handler: async (
        input: unknown,
        context: PluginContext
      ): Promise<ToolResult> => {
        const { chainId, amount, userAddress } = input as {
          chainId: string;
          amount: string;
          userAddress: string;
        };
        return this.buildTx(chainId, amount, userAddress, "supply", context);
      },
    };
  }

  private withdrawTxTool(): ToolDefinition {
    return {
      name: "defi_compound_withdraw_tx",
      description: `Build an unsigned transaction to withdraw the base asset from Compound V3. Use amount "max" to withdraw entire balance. Supported chains: ${SUPPORTED.join(", ")}.`,
      inputSchema: z.object({
        chainId: ChainIdSchema,
        amount: AmountSchema.describe(
          'Amount to withdraw, or "max" for full balance'
        ),
        userAddress: AddressSchema.describe(
          "Wallet address that will sign and send this transaction"
        ),
      }),
      handler: async (
        input: unknown,
        context: PluginContext
      ): Promise<ToolResult> => {
        const { chainId, amount, userAddress } = input as {
          chainId: string;
          amount: string;
          userAddress: string;
        };
        return this.buildTx(chainId, amount, userAddress, "withdraw", context);
      },
    };
  }

  private async buildTx(
    chainId: string,
    amount: string,
    userAddress: string,
    action: "supply" | "withdraw",
    _context: PluginContext
  ): Promise<ToolResult> {
    const market = COMPOUND_V3_MARKETS[chainId];
    if (!market) {
      return {
        content: [
          {
            type: "text",
            text: `Compound V3 not available on "${chainId}". Supported: ${SUPPORTED.join(", ")}`,
          },
        ],
        isError: true,
      };
    }

    const user = getAddress(userAddress);
    const isMax = amount.toLowerCase() === "max";
    const rawAmount = isMax
      ? maxUint256
      : BigInt(parseTokenAmount(amount, market.baseTokenDecimals));

    const data = encodeFunctionData({
      abi: COMET_ABI,
      functionName: action,
      args: [market.baseTokenAddress, rawAmount],
    });

    const description =
      action === "supply"
        ? `Supply ${amount} ${market.baseToken} to Compound V3`
        : `Withdraw ${isMax ? "all" : amount} ${market.baseToken} from Compound V3`;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              chainId,
              ecosystem: "evm",
              raw: {
                to: market.comet,
                data,
                value: "0x0",
                from: user,
              },
              description,
              note:
                action === "supply"
                  ? `Make sure ${market.baseToken} is approved for ${market.comet} first (use defi_token_approve with tokenAddress=${market.baseTokenAddress} and spender=${market.comet})`
                  : undefined,
            },
            null,
            2
          ),
        },
      ],
    };
  }
}
