import { z } from "zod";
import { encodeFunctionData, getAddress, parseEther } from "viem";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";
import { ChainIdSchema, AddressSchema, AmountSchema } from "../../tools/schemas.js";

const WETH_ADDRESSES: Record<string, string> = {
  ethereum: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  arbitrum: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  optimism: "0x4200000000000000000000000000000000000006",
  base: "0x4200000000000000000000000000000000000006",
  polygon: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", // WMATIC
  avalanche: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", // WAVAX
  bsc: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", // WBNB
};

const NATIVE_NAMES: Record<string, [string, string]> = {
  ethereum: ["ETH", "WETH"],
  arbitrum: ["ETH", "WETH"],
  optimism: ["ETH", "WETH"],
  base: ["ETH", "WETH"],
  polygon: ["MATIC", "WMATIC"],
  avalanche: ["AVAX", "WAVAX"],
  bsc: ["BNB", "WBNB"],
};

const WETH_ABI = [
  {
    name: "deposit",
    type: "function" as const,
    stateMutability: "payable" as const,
    inputs: [],
    outputs: [],
  },
  {
    name: "withdraw",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [{ name: "wad", type: "uint256" }],
    outputs: [],
  },
] as const;

const SUPPORTED = Object.keys(WETH_ADDRESSES);

export class WethPlugin implements DefiPlugin {
  readonly name = "weth";
  readonly description = "Wrap/unwrap native tokens (ETH→WETH, MATIC→WMATIC, etc.)";
  readonly version = "1.0.0";

  async initialize(_ctx: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [this.wrapTool(), this.unwrapTool()];
  }

  private wrapTool(): ToolDefinition {
    return {
      name: "defi_weth_wrap_tx",
      description: `Build an unsigned transaction to wrap native tokens (ETH→WETH, MATIC→WMATIC, AVAX→WAVAX, BNB→WBNB). Required before using native tokens in most DeFi protocols. Supported chains: ${SUPPORTED.join(", ")}.`,
      inputSchema: z.object({
        chainId: ChainIdSchema,
        amount: AmountSchema.describe("Amount of native token to wrap"),
        userAddress: AddressSchema.describe("Your wallet address"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const { chainId, amount, userAddress } = input as {
          chainId: string; amount: string; userAddress: string;
        };

        const wethAddr = WETH_ADDRESSES[chainId];
        if (!wethAddr) {
          return {
            content: [{ type: "text", text: `Wrap not available on "${chainId}". Supported: ${SUPPORTED.join(", ")}` }],
            isError: true,
          };
        }

        const [nativeName, wrappedName] = NATIVE_NAMES[chainId] || ["ETH", "WETH"];
        const value = `0x${parseEther(amount).toString(16)}`;

        const data = encodeFunctionData({
          abi: WETH_ABI,
          functionName: "deposit",
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              chainId,
              ecosystem: "evm",
              raw: {
                to: wethAddr,
                data,
                value,
                from: getAddress(userAddress),
              },
              description: `Wrap ${amount} ${nativeName} → ${wrappedName}`,
            }, null, 2),
          }],
        };
      },
    };
  }

  private unwrapTool(): ToolDefinition {
    return {
      name: "defi_weth_unwrap_tx",
      description: `Build an unsigned transaction to unwrap wrapped native tokens (WETH→ETH, WMATIC→MATIC, WAVAX→AVAX, WBNB→BNB). Supported chains: ${SUPPORTED.join(", ")}.`,
      inputSchema: z.object({
        chainId: ChainIdSchema,
        amount: AmountSchema.describe("Amount of wrapped token to unwrap"),
        userAddress: AddressSchema.describe("Your wallet address"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const { chainId, amount, userAddress } = input as {
          chainId: string; amount: string; userAddress: string;
        };

        const wethAddr = WETH_ADDRESSES[chainId];
        if (!wethAddr) {
          return {
            content: [{ type: "text", text: `Unwrap not available on "${chainId}". Supported: ${SUPPORTED.join(", ")}` }],
            isError: true,
          };
        }

        const [nativeName, wrappedName] = NATIVE_NAMES[chainId] || ["ETH", "WETH"];
        const rawAmount = parseEther(amount);

        const data = encodeFunctionData({
          abi: WETH_ABI,
          functionName: "withdraw",
          args: [rawAmount],
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              chainId,
              ecosystem: "evm",
              raw: {
                to: wethAddr,
                data,
                value: "0x0",
                from: getAddress(userAddress),
              },
              description: `Unwrap ${amount} ${wrappedName} → ${nativeName}`,
            }, null, 2),
          }],
        };
      },
    };
  }
}
