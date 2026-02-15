import { z } from "zod";
import {
  getAddress,
  encodeFunctionData,
  parseUnits,
  parseEther,
  erc20Abi,
} from "viem";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";
import { ChainIdSchema, AddressSchema, AmountSchema } from "../../tools/schemas.js";

export class TransfersPlugin implements DefiPlugin {
  readonly name = "transfers";
  readonly description = "Build unsigned token and native transfer transactions";
  readonly version = "1.0.0";

  async initialize(_ctx: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [this.transferTool(), this.nativeTransferTool()];
  }

  private transferTool(): ToolDefinition {
    return {
      name: "defi_transfer_tx",
      description:
        "Build an unsigned ERC20 token transfer transaction. Returns transaction data ready for signing.",
      inputSchema: z.object({
        chainId: ChainIdSchema,
        token: z.string().describe("Token symbol or contract address"),
        to: AddressSchema.describe("Recipient address"),
        amount: AmountSchema,
        from: AddressSchema.describe("Sender address"),
      }),
      handler: async (
        input: unknown,
        context: PluginContext
      ): Promise<ToolResult> => {
        const { chainId, token, to, amount, from } = input as {
          chainId: string; token: string; to: string; amount: string; from: string;
        };

        const adapter = context.getChainAdapterForChain(chainId);
        const resolved = await adapter.resolveToken(chainId, token);
        if (!resolved) {
          return {
            content: [{ type: "text", text: `Token "${token}" not found on "${chainId}"` }],
            isError: true,
          };
        }

        const rawAmount = parseUnits(amount, resolved.decimals);

        const data = encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [getAddress(to), rawAmount],
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  chainId,
                  ecosystem: "evm",
                  raw: {
                    to: getAddress(resolved.address),
                    data,
                    value: "0x0",
                    from: getAddress(from),
                  },
                  description: `Transfer ${amount} ${resolved.symbol} to ${to}`,
                },
                null,
                2
              ),
            },
          ],
        };
      },
    };
  }

  private nativeTransferTool(): ToolDefinition {
    return {
      name: "defi_native_transfer_tx",
      description:
        "Build an unsigned native token transfer transaction (ETH, MATIC, etc). Returns transaction data ready for signing.",
      inputSchema: z.object({
        chainId: ChainIdSchema,
        to: AddressSchema.describe("Recipient address"),
        amount: AmountSchema.describe("Amount in native token (e.g. ETH)"),
        from: AddressSchema.describe("Sender address"),
      }),
      handler: async (
        input: unknown,
        context: PluginContext
      ): Promise<ToolResult> => {
        const { chainId, to, amount, from } = input as {
          chainId: string; to: string; amount: string; from: string;
        };

        const chain = context.getChainAdapterForChain(chainId).getChain(chainId);
        if (!chain) {
          return {
            content: [{ type: "text", text: `Chain "${chainId}" not found` }],
            isError: true,
          };
        }

        const value = parseEther(amount);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  chainId,
                  ecosystem: "evm",
                  raw: {
                    to: getAddress(to),
                    data: "0x",
                    value: `0x${value.toString(16)}`,
                    from: getAddress(from),
                  },
                  description: `Transfer ${amount} ${chain.nativeToken.symbol} to ${to}`,
                },
                null,
                2
              ),
            },
          ],
        };
      },
    };
  }
}
