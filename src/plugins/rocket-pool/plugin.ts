import { z } from "zod";
import {
  createPublicClient,
  http,
  getAddress,
  encodeFunctionData,
  parseEther,
  parseUnits,
  formatUnits,
} from "viem";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";
import { AddressSchema, AmountSchema } from "../../tools/schemas.js";
import {
  RETH_ADDRESS,
  ROCKET_DEPOSIT_POOL,
  RETH_ABI,
  DEPOSIT_POOL_ABI,
} from "./abi.js";

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function errorResult(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }], isError: true };
}

export class RocketPoolPlugin implements DefiPlugin {
  readonly name = "rocket-pool";
  readonly description = "Rocket Pool: stake ETH for rETH, check exchange rate, unstake";
  readonly version = "1.0.0";

  async initialize(_ctx: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [this.infoTool(), this.stakeTxTool(), this.unstakeTxTool()];
  }

  private infoTool(): ToolDefinition {
    return {
      name: "defi_rocketpool_info",
      description:
        "Get Rocket Pool rETH exchange rate, total collateral, and current APR. Ethereum only.",
      inputSchema: z.object({}),
      handler: async (_input: unknown, context: PluginContext): Promise<ToolResult> => {
        try {
          const chain = context.getChainAdapterForChain("ethereum").getChain("ethereum")!;
          const rpcUrl = context.config.rpcUrls["ethereum"] || chain.rpcUrl;
          const client = createPublicClient({ transport: http(rpcUrl) });

          const [exchangeRate, totalCollateral] = await Promise.all([
            client.readContract({
              address: RETH_ADDRESS,
              abi: RETH_ABI,
              functionName: "getExchangeRate",
            }),
            client.readContract({
              address: RETH_ADDRESS,
              abi: RETH_ABI,
              functionName: "getTotalCollateral",
            }),
          ]);

          const rate = Number(formatUnits(exchangeRate, 18));
          const collateral = Number(formatUnits(totalCollateral, 18));

          // Estimate APR from exchange rate growth (~3-4% historically)
          let apr = "~3.5%";
          try {
            const res = await fetch("https://rocketpool.net/api/mainnet/payload");
            if (res.ok) {
              const data = await res.json();
              if (data.rethAPR) apr = `${Number(data.rethAPR).toFixed(2)}%`;
            }
          } catch { /* fallback to estimate */ }

          return jsonResult({
            protocol: "Rocket Pool",
            chain: "ethereum",
            rethAddress: RETH_ADDRESS,
            exchangeRate: `1 rETH = ${rate.toFixed(6)} ETH`,
            totalCollateralEth: collateral.toFixed(2),
            apr,
          });
        } catch (e: any) {
          return errorResult(`Failed to fetch Rocket Pool info: ${e.message}`);
        }
      },
    };
  }

  private stakeTxTool(): ToolDefinition {
    return {
      name: "defi_rocketpool_stake_tx",
      description:
        "Build an unsigned transaction to stake ETH via Rocket Pool and receive rETH. Ethereum only.",
      inputSchema: z.object({
        amount: AmountSchema.describe("Amount of ETH to stake"),
        userAddress: AddressSchema.describe("Wallet address that will sign"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const { amount, userAddress } = input as { amount: string; userAddress: string };
        const user = getAddress(userAddress);
        const value = parseEther(amount);

        const data = encodeFunctionData({
          abi: DEPOSIT_POOL_ABI,
          functionName: "deposit",
        });

        return jsonResult({
          chainId: "ethereum",
          ecosystem: "evm",
          raw: {
            to: ROCKET_DEPOSIT_POOL,
            data,
            value: `0x${value.toString(16)}`,
            from: user,
          },
          description: `Stake ${amount} ETH via Rocket Pool → receive rETH`,
        });
      },
    };
  }

  private unstakeTxTool(): ToolDefinition {
    return {
      name: "defi_rocketpool_unstake_tx",
      description:
        "Build an unsigned transaction to burn rETH and receive ETH back from Rocket Pool. Ethereum only.",
      inputSchema: z.object({
        amount: AmountSchema.describe("Amount of rETH to burn"),
        userAddress: AddressSchema.describe("Wallet address that will sign"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const { amount, userAddress } = input as { amount: string; userAddress: string };
        const user = getAddress(userAddress);
        const rawAmount = parseUnits(amount, 18);

        const data = encodeFunctionData({
          abi: RETH_ABI,
          functionName: "burn",
          args: [rawAmount],
        });

        return jsonResult({
          chainId: "ethereum",
          ecosystem: "evm",
          raw: {
            to: RETH_ADDRESS,
            data,
            value: "0x0",
            from: user,
          },
          description: `Burn ${amount} rETH → receive ETH`,
        });
      },
    };
  }
}
