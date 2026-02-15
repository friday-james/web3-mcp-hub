import { z } from "zod";
import { getAddress, encodeFunctionData, maxUint256 } from "viem";
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
import { COMET_ABI } from "./abi.js";

const SUPPORTED = getSupportedCompoundV3Chains();

export class CompoundV3Plugin implements DefiPlugin {
  readonly name = "compound-v3";
  readonly description =
    "Compound V3 lending: supply and withdraw base assets (USDC)";
  readonly version = "1.0.0";

  async initialize(_context: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [this.supplyTxTool(), this.withdrawTxTool()];
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
