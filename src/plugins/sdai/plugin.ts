import { z } from "zod";
import {
  createPublicClient,
  http,
  getAddress,
  encodeFunctionData,
  parseUnits,
  formatUnits,
  maxUint256,
} from "viem";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";
import { AddressSchema, AmountSchema } from "../../tools/schemas.js";

const SDAI_ADDRESS: `0x${string}` = "0x83F20F44975D03b1b09e64809B757c47f942BEeA";
const DAI_ADDRESS: `0x${string}` = "0x6B175474E89094C44Da98b954EedeB131715A767";

const SDAI_ABI = [
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
  {
    name: "convertToAssets",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "totalAssets",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function errorResult(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }], isError: true };
}

export class SDaiPlugin implements DefiPlugin {
  readonly name = "sdai";
  readonly description = "MakerDAO/Sky sDAI: earn DAI Savings Rate by depositing DAI into sDAI";
  readonly version = "1.0.0";

  async initialize(_ctx: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [this.infoTool(), this.depositTxTool(), this.withdrawTxTool()];
  }

  private infoTool(): ToolDefinition {
    return {
      name: "defi_sdai_info",
      description:
        "Get sDAI exchange rate, total deposits, and current DAI Savings Rate (DSR). Ethereum only.",
      inputSchema: z.object({}),
      handler: async (_input: unknown, context: PluginContext): Promise<ToolResult> => {
        try {
          const chain = context.getChainAdapterForChain("ethereum").getChain("ethereum")!;
          const rpcUrl = context.config.rpcUrls["ethereum"] || chain.rpcUrl;
          const client = createPublicClient({ transport: http(rpcUrl) });

          const [totalAssets, rateRaw] = await Promise.all([
            client.readContract({
              address: SDAI_ADDRESS,
              abi: SDAI_ABI,
              functionName: "totalAssets",
            }),
            client.readContract({
              address: SDAI_ADDRESS,
              abi: SDAI_ABI,
              functionName: "convertToAssets",
              args: [parseUnits("1", 18)],
            }),
          ]);

          const exchangeRate = Number(formatUnits(rateRaw, 18));
          const tvl = Number(formatUnits(totalAssets, 18));

          return jsonResult({
            protocol: "MakerDAO / Sky",
            chain: "ethereum",
            sdaiAddress: SDAI_ADDRESS,
            daiAddress: DAI_ADDRESS,
            exchangeRate: `1 sDAI = ${exchangeRate.toFixed(6)} DAI`,
            totalDepositsDAI: tvl.toFixed(0),
            note: "Deposit DAI to receive sDAI and earn the DAI Savings Rate automatically",
          });
        } catch (e: any) {
          return errorResult(`Failed to fetch sDAI info: ${e.message}`);
        }
      },
    };
  }

  private depositTxTool(): ToolDefinition {
    return {
      name: "defi_sdai_deposit_tx",
      description:
        "Build an unsigned transaction to deposit DAI into sDAI and earn the DAI Savings Rate. DAI must be approved for sDAI first (use defi_token_approve). Ethereum only.",
      inputSchema: z.object({
        amount: AmountSchema.describe("Amount of DAI to deposit"),
        userAddress: AddressSchema.describe("Wallet address that will sign"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const { amount, userAddress } = input as { amount: string; userAddress: string };
        const user = getAddress(userAddress);
        const rawAmount = parseUnits(amount, 18);

        const data = encodeFunctionData({
          abi: SDAI_ABI,
          functionName: "deposit",
          args: [rawAmount, user],
        });

        return jsonResult({
          chainId: "ethereum",
          ecosystem: "evm",
          raw: { to: SDAI_ADDRESS, data, value: "0x0", from: user },
          description: `Deposit ${amount} DAI → receive sDAI (earning DSR)`,
          note: `Approve DAI for ${SDAI_ADDRESS} first (use defi_token_approve with tokenAddress=${DAI_ADDRESS} and spender=${SDAI_ADDRESS})`,
        });
      },
    };
  }

  private withdrawTxTool(): ToolDefinition {
    return {
      name: "defi_sdai_withdraw_tx",
      description:
        'Build an unsigned transaction to redeem sDAI and receive DAI back. Use amount "max" to redeem all. Ethereum only.',
      inputSchema: z.object({
        amount: AmountSchema.describe('Amount of DAI to withdraw, or "max" for all sDAI'),
        userAddress: AddressSchema.describe("Wallet address that will sign"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const { amount, userAddress } = input as { amount: string; userAddress: string };
        const user = getAddress(userAddress);
        const isMax = amount.toLowerCase() === "max";

        let data: `0x${string}`;
        if (isMax) {
          data = encodeFunctionData({
            abi: SDAI_ABI,
            functionName: "redeem",
            args: [maxUint256, user, user],
          });
        } else {
          const rawAmount = parseUnits(amount, 18);
          data = encodeFunctionData({
            abi: SDAI_ABI,
            functionName: "withdraw",
            args: [rawAmount, user, user],
          });
        }

        return jsonResult({
          chainId: "ethereum",
          ecosystem: "evm",
          raw: { to: SDAI_ADDRESS, data, value: "0x0", from: user },
          description: `Withdraw ${isMax ? "all" : amount} DAI from sDAI`,
        });
      },
    };
  }
}
