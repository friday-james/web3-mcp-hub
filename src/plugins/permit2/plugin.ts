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

// Permit2 canonical address (same on all EVM chains)
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

const SUPPORTED = [
  "ethereum", "arbitrum", "optimism", "polygon", "base", "avalanche", "bsc",
];

const PERMIT2_APPROVE_ABI = [
  {
    name: "approve",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
    ],
    outputs: [],
  },
] as const;

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function errorResult(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }], isError: true };
}

export class Permit2Plugin implements DefiPlugin {
  readonly name = "permit2";
  readonly description =
    "Uniswap Permit2: gasless token approvals and allowance management";
  readonly version = "1.0.0";

  async initialize(_ctx: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [this.approvePermit2Tool(), this.permit2AllowanceTool()];
  }

  private approvePermit2Tool(): ToolDefinition {
    return {
      name: "defi_permit2_approve_tx",
      description: `Build an unsigned transaction to set a Permit2 allowance for a spender. Permit2 is used by Uniswap and many modern DeFi protocols for more gas-efficient approvals. First approve the token for Permit2, then use this to set per-protocol allowances. Supported chains: ${SUPPORTED.join(", ")}.`,
      inputSchema: z.object({
        chainId: ChainIdSchema,
        tokenAddress: AddressSchema.describe("ERC20 token to approve"),
        spender: AddressSchema.describe("Protocol address to grant allowance"),
        amount: AmountSchema.optional().describe("Amount to approve (default: max)"),
        expirationDays: z.number().int().min(1).max(365).optional().describe("Days until expiration (default 30)"),
        userAddress: AddressSchema.describe("Your wallet address"),
      }),
      handler: async (input: unknown, context: PluginContext): Promise<ToolResult> => {
        try {
          const { chainId, tokenAddress, spender, amount, expirationDays = 30, userAddress } = input as {
            chainId: string; tokenAddress: string; spender: string;
            amount?: string; expirationDays?: number; userAddress: string;
          };

          if (!SUPPORTED.includes(chainId)) {
            return errorResult(`Permit2 not available on "${chainId}". Supported: ${SUPPORTED.join(", ")}`);
          }

          const adapter = context.getChainAdapterForChain(chainId);
          const token = await adapter.resolveToken(chainId, tokenAddress);
          const decimals = token?.decimals ?? 18;

          // Permit2 uses uint160 for amounts
          const MAX_UINT160 = (1n << 160n) - 1n;
          const approveAmount = amount
            ? BigInt(parseTokenAmount(amount, decimals))
            : MAX_UINT160;

          const expiration = Math.floor(Date.now() / 1000) + expirationDays * 86400;

          const data = encodeFunctionData({
            abi: PERMIT2_APPROVE_ABI,
            functionName: "approve",
            args: [
              getAddress(tokenAddress),
              getAddress(spender),
              approveAmount > MAX_UINT160 ? MAX_UINT160 : approveAmount,
              expiration,
            ],
          });

          return jsonResult({
            chainId,
            ecosystem: "evm",
            raw: {
              to: PERMIT2_ADDRESS,
              data,
              value: "0x0",
              from: getAddress(userAddress),
            },
            description: amount
              ? `Set Permit2 allowance: ${amount} ${token?.symbol || "tokens"} for ${spender} (expires in ${expirationDays} days)`
              : `Set max Permit2 allowance: ${token?.symbol || "tokens"} for ${spender} (expires in ${expirationDays} days)`,
            note: `Make sure the token (${tokenAddress}) is first approved for the Permit2 contract (${PERMIT2_ADDRESS}) via defi_token_approve`,
          });
        } catch (e: any) {
          return errorResult(`Failed to build Permit2 approve tx: ${e.message}`);
        }
      },
    };
  }

  private permit2AllowanceTool(): ToolDefinition {
    return {
      name: "defi_permit2_allowance",
      description: `Check the current Permit2 allowance for a token/spender pair. Shows the approved amount and expiration. Supported chains: ${SUPPORTED.join(", ")}.`,
      inputSchema: z.object({
        chainId: ChainIdSchema,
        tokenAddress: AddressSchema.describe("ERC20 token address"),
        owner: AddressSchema.describe("Token owner address"),
        spender: AddressSchema.describe("Spender to check"),
      }),
      handler: async (input: unknown, context: PluginContext): Promise<ToolResult> => {
        try {
          const { chainId, tokenAddress, owner, spender } = input as {
            chainId: string; tokenAddress: string; owner: string; spender: string;
          };

          if (!SUPPORTED.includes(chainId)) {
            return errorResult(`Permit2 not available on "${chainId}"`);
          }

          const adapter = context.getChainAdapterForChain(chainId);
          const chain = adapter.getChain(chainId);
          if (!chain) return errorResult(`Chain "${chainId}" not found`);

          const { createPublicClient, http } = await import("viem");
          const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
          const client = createPublicClient({ transport: http(rpcUrl) });

          const allowanceAbi = [{
            name: "allowance",
            type: "function" as const,
            stateMutability: "view" as const,
            inputs: [
              { name: "owner", type: "address" },
              { name: "token", type: "address" },
              { name: "spender", type: "address" },
            ],
            outputs: [
              { name: "amount", type: "uint160" },
              { name: "expiration", type: "uint48" },
              { name: "nonce", type: "uint48" },
            ],
          }] as const;

          const [amount, expiration, nonce] = await client.readContract({
            address: PERMIT2_ADDRESS as `0x${string}`,
            abi: allowanceAbi,
            functionName: "allowance",
            args: [getAddress(owner), getAddress(tokenAddress), getAddress(spender)],
          });

          const token = await adapter.resolveToken(chainId, tokenAddress);
          const decimals = token?.decimals ?? 18;
          const { formatTokenAmount } = await import("../../core/utils.js");

          const MAX_UINT160 = (1n << 160n) - 1n;
          const isUnlimited = amount >= MAX_UINT160 / 2n;
          const isExpired = Number(expiration) < Math.floor(Date.now() / 1000);

          return jsonResult({
            chain: chainId,
            permit2: PERMIT2_ADDRESS,
            token: token?.symbol || tokenAddress,
            owner,
            spender,
            amount: isUnlimited ? "unlimited" : formatTokenAmount(amount.toString(), decimals),
            expiration: new Date(Number(expiration) * 1000).toISOString(),
            expired: isExpired,
            nonce: Number(nonce),
          });
        } catch (e: any) {
          return errorResult(`Failed to check Permit2 allowance: ${e.message}`);
        }
      },
    };
  }
}
