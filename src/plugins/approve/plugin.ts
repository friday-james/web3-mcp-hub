import { z } from "zod";
import { encodeFunctionData, getAddress, maxUint256 } from "viem";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";
import { ChainIdSchema, AddressSchema, AmountSchema } from "../../tools/schemas.js";
import { parseTokenAmount } from "../../core/utils.js";

const APPROVE_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

export class ApprovePlugin implements DefiPlugin {
  readonly name = "approve";
  readonly description = "ERC20 token approval management";
  readonly version = "1.0.0";

  async initialize(_context: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [
      {
        name: "defi_token_approve",
        description:
          "Build an unsigned ERC20 approve transaction. Required before swapping tokens on EVM chains. Returns an unsigned transaction to approve a spender to spend tokens on your behalf.",
        inputSchema: z.object({
          chainId: ChainIdSchema,
          tokenAddress: AddressSchema.describe("ERC20 token contract address"),
          spender: AddressSchema.describe(
            "Address to approve (e.g. DEX router)"
          ),
          amount: AmountSchema.optional().describe(
            'Amount to approve in human-readable form. If omitted, approves max (unlimited).'
          ),
          ownerAddress: AddressSchema.describe("Your wallet address"),
        }),
        handler: async (
          input: unknown,
          context: PluginContext
        ): Promise<ToolResult> => {
          const { chainId, tokenAddress, spender, amount, ownerAddress } =
            input as {
              chainId: string;
              tokenAddress: string;
              spender: string;
              amount?: string;
              ownerAddress: string;
            };

          const adapter = context.getChainAdapterForChain(chainId);
          const chain = adapter.getChain(chainId);
          if (!chain || chain.ecosystem !== "evm") {
            return {
              content: [
                {
                  type: "text",
                  text: "Token approvals are only needed on EVM chains",
                },
              ],
              isError: true,
            };
          }

          // Resolve token to get decimals
          const token = await adapter.resolveToken(chainId, tokenAddress);
          const decimals = token?.decimals ?? 18;

          const approveAmount = amount
            ? BigInt(parseTokenAmount(amount, decimals))
            : maxUint256;

          const data = encodeFunctionData({
            abi: APPROVE_ABI,
            functionName: "approve",
            args: [getAddress(spender), approveAmount],
          });

          const tx = {
            chainId: chain.id,
            ecosystem: "evm" as const,
            raw: {
              to: getAddress(tokenAddress),
              data,
              value: "0x0",
              from: getAddress(ownerAddress),
            },
            description: amount
              ? `Approve ${amount} ${token?.symbol || "tokens"} for ${spender}`
              : `Approve unlimited ${token?.symbol || "tokens"} for ${spender}`,
          };

          return {
            content: [
              { type: "text", text: JSON.stringify(tx, null, 2) },
            ],
          };
        },
      },
      {
        name: "defi_check_allowance",
        description:
          "Check the current ERC20 token allowance for a spender. Returns how much of a token a spender is approved to use.",
        inputSchema: z.object({
          chainId: ChainIdSchema,
          tokenAddress: AddressSchema.describe("ERC20 token contract address"),
          owner: AddressSchema.describe("Token owner address"),
          spender: AddressSchema.describe("Spender address to check"),
        }),
        handler: async (
          input: unknown,
          context: PluginContext
        ): Promise<ToolResult> => {
          const { chainId, tokenAddress, owner, spender } = input as {
            chainId: string;
            tokenAddress: string;
            owner: string;
            spender: string;
          };

          const adapter = context.getChainAdapterForChain(chainId);
          const chain = adapter.getChain(chainId);
          if (!chain || chain.ecosystem !== "evm") {
            return {
              content: [
                {
                  type: "text",
                  text: "Allowances are only applicable on EVM chains",
                },
              ],
              isError: true,
            };
          }

          const { createPublicClient, http } = await import("viem");
          const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
          const client = createPublicClient({ transport: http(rpcUrl) });

          const allowance = await client.readContract({
            address: getAddress(tokenAddress),
            abi: APPROVE_ABI,
            functionName: "allowance",
            args: [getAddress(owner), getAddress(spender)],
          });

          const token = await adapter.resolveToken(chainId, tokenAddress);
          const decimals = token?.decimals ?? 18;
          const { formatTokenAmount } = await import("../../core/utils.js");

          const isUnlimited = allowance >= maxUint256 / 2n;

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    token: token?.symbol || tokenAddress,
                    owner,
                    spender,
                    allowanceRaw: allowance.toString(),
                    allowanceFormatted: isUnlimited
                      ? "unlimited"
                      : formatTokenAmount(allowance.toString(), decimals),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        },
      },
    ];
  }
}
