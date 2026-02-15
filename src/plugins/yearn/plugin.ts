import { z } from "zod";
import { getAddress, encodeFunctionData, parseUnits, maxUint256 } from "viem";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";
import { ChainIdSchema, AddressSchema, AmountSchema } from "../../tools/schemas.js";

const YDAEMON = "https://ydaemon.yearn.fi";

const CHAIN_MAP: Record<string, number> = {
  ethereum: 1, optimism: 10, polygon: 137, base: 8453, arbitrum: 42161,
};

// ERC4626 vault ABI (Yearn V3 uses this standard)
const VAULT_ABI = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    name: "redeem",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ name: "assets", type: "uint256" }],
  },
] as const;

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function errorResult(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }], isError: true };
}

export class YearnPlugin implements DefiPlugin {
  readonly name = "yearn";
  readonly description = "Yearn V3 yield vaults: list vaults, deposit, withdraw";
  readonly version = "1.0.0";

  async initialize(_ctx: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [
      this.vaultsTool(),
      this.depositTxTool(),
      this.withdrawTxTool(),
    ];
  }

  private vaultsTool(): ToolDefinition {
    return {
      name: "defi_yearn_vaults",
      description: `List Yearn V3 vaults with APY, TVL, and underlying token. Supported chains: ${Object.keys(CHAIN_MAP).join(", ")}.`,
      inputSchema: z.object({
        chainId: ChainIdSchema,
        limit: z.number().int().min(1).max(50).optional().describe("Number of results (default 20)"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { chainId, limit = 20 } = input as { chainId: string; limit?: number };
          const numericId = CHAIN_MAP[chainId];
          if (!numericId) return errorResult(`Yearn not available on "${chainId}". Supported: ${Object.keys(CHAIN_MAP).join(", ")}`);

          const res = await fetch(`${YDAEMON}/${numericId}/vaults/all`);
          if (!res.ok) throw new Error(`yDaemon ${res.status}`);
          const data = await res.json();

          const vaults = (data as any[])
            .filter((v) => v.tvl?.totalAssets > 0)
            .sort((a, b) => (b.tvl?.tvl || 0) - (a.tvl?.tvl || 0))
            .slice(0, limit)
            .map((v) => ({
              name: v.name,
              address: v.address,
              token: v.token?.symbol,
              tokenAddress: v.token?.address,
              tokenDecimals: v.token?.decimals,
              apy: v.apr?.netAPR != null ? `${(v.apr.netAPR * 100).toFixed(2)}%` : "N/A",
              tvl: v.tvl?.tvl,
              version: v.version,
              category: v.category,
            }));

          return jsonResult({ chain: chainId, count: vaults.length, vaults });
        } catch (e: any) {
          return errorResult(`Failed to fetch Yearn vaults: ${e.message}`);
        }
      },
    };
  }

  private depositTxTool(): ToolDefinition {
    return {
      name: "defi_yearn_deposit_tx",
      description:
        "Build an unsigned transaction to deposit into a Yearn V3 vault. The underlying token must be approved for the vault first (use defi_token_approve).",
      inputSchema: z.object({
        chainId: ChainIdSchema,
        vaultAddress: AddressSchema.describe("Yearn vault contract address"),
        amount: AmountSchema,
        tokenDecimals: z.number().int().describe("Decimals of the underlying token"),
        userAddress: AddressSchema.describe("Wallet address that will sign"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const { chainId, vaultAddress, amount, tokenDecimals, userAddress } = input as {
          chainId: string; vaultAddress: string; amount: string;
          tokenDecimals: number; userAddress: string;
        };

        const user = getAddress(userAddress);
        const vault = getAddress(vaultAddress);
        const rawAmount = parseUnits(amount, tokenDecimals);

        const data = encodeFunctionData({
          abi: VAULT_ABI,
          functionName: "deposit",
          args: [rawAmount, user],
        });

        return jsonResult({
          chainId,
          ecosystem: "evm",
          raw: { to: vault, data, value: "0x0", from: user },
          description: `Deposit ${amount} into Yearn vault ${vaultAddress}`,
          note: `Approve the underlying token for ${vault} first (use defi_token_approve)`,
        });
      },
    };
  }

  private withdrawTxTool(): ToolDefinition {
    return {
      name: "defi_yearn_withdraw_tx",
      description:
        'Build an unsigned transaction to withdraw from a Yearn V3 vault. Use amount "max" to redeem all shares.',
      inputSchema: z.object({
        chainId: ChainIdSchema,
        vaultAddress: AddressSchema.describe("Yearn vault contract address"),
        amount: AmountSchema.describe('Amount of underlying to withdraw, or "max" for all'),
        tokenDecimals: z.number().int().describe("Decimals of the underlying token"),
        userAddress: AddressSchema.describe("Wallet address that will sign"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const { chainId, vaultAddress, amount, tokenDecimals, userAddress } = input as {
          chainId: string; vaultAddress: string; amount: string;
          tokenDecimals: number; userAddress: string;
        };

        const user = getAddress(userAddress);
        const vault = getAddress(vaultAddress);
        const isMax = amount.toLowerCase() === "max";

        let data: `0x${string}`;
        if (isMax) {
          data = encodeFunctionData({
            abi: VAULT_ABI,
            functionName: "redeem",
            args: [maxUint256, user, user],
          });
        } else {
          const rawAmount = parseUnits(amount, tokenDecimals);
          data = encodeFunctionData({
            abi: VAULT_ABI,
            functionName: "withdraw",
            args: [rawAmount, user, user],
          });
        }

        return jsonResult({
          chainId,
          ecosystem: "evm",
          raw: { to: vault, data, value: "0x0", from: user },
          description: `Withdraw ${isMax ? "all" : amount} from Yearn vault ${vaultAddress}`,
        });
      },
    };
  }
}
