import { z } from "zod";
import { getAddress, encodeFunctionData, parseEther, parseUnits } from "viem";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";
import { ChainIdSchema, AddressSchema, AmountSchema } from "../../tools/schemas.js";
import { STETH_ADDRESS, WSTETH_ADDRESSES, getSupportedLidoChains } from "./addresses.js";
import { STETH_ABI, WSTETH_ABI } from "./abi.js";

const SUPPORTED = getSupportedLidoChains();

export class LidoPlugin implements DefiPlugin {
  readonly name = "lido";
  readonly description = "Lido liquid staking: stake ETH, wrap/unwrap stETH↔wstETH";
  readonly version = "1.0.0";

  async initialize(_context: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [this.stakeTxTool(), this.wrapTxTool(), this.unwrapTxTool()];
  }

  private stakeTxTool(): ToolDefinition {
    return {
      name: "defi_lido_stake_tx",
      description:
        "Build an unsigned transaction to stake ETH via Lido and receive stETH. Ethereum only. Sends ETH as msg.value.",
      inputSchema: z.object({
        amount: AmountSchema.describe("Amount of ETH to stake"),
        userAddress: AddressSchema.describe(
          "Wallet address that will sign and send this transaction"
        ),
      }),
      handler: async (
        input: unknown,
        _context: PluginContext
      ): Promise<ToolResult> => {
        const { amount, userAddress } = input as {
          amount: string;
          userAddress: string;
        };

        const user = getAddress(userAddress);
        const value = parseEther(amount);

        const data = encodeFunctionData({
          abi: STETH_ABI,
          functionName: "submit",
          args: ["0x0000000000000000000000000000000000000000"],
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  chainId: "ethereum",
                  ecosystem: "evm",
                  raw: {
                    to: STETH_ADDRESS,
                    data,
                    value: `0x${value.toString(16)}`,
                    from: user,
                  },
                  description: `Stake ${amount} ETH via Lido → receive stETH`,
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

  private wrapTxTool(): ToolDefinition {
    return {
      name: "defi_lido_wrap_tx",
      description: `Build an unsigned transaction to wrap stETH into wstETH. stETH must be approved for the wstETH contract first (use defi_token_approve). Ethereum only.`,
      inputSchema: z.object({
        amount: AmountSchema.describe("Amount of stETH to wrap"),
        userAddress: AddressSchema.describe(
          "Wallet address that will sign and send this transaction"
        ),
      }),
      handler: async (
        input: unknown,
        _context: PluginContext
      ): Promise<ToolResult> => {
        const { amount, userAddress } = input as {
          amount: string;
          userAddress: string;
        };

        const wstethAddr = WSTETH_ADDRESSES["ethereum"];
        const user = getAddress(userAddress);
        const rawAmount = parseUnits(amount, 18);

        const data = encodeFunctionData({
          abi: WSTETH_ABI,
          functionName: "wrap",
          args: [rawAmount],
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  chainId: "ethereum",
                  ecosystem: "evm",
                  raw: {
                    to: wstethAddr,
                    data,
                    value: "0x0",
                    from: user,
                  },
                  description: `Wrap ${amount} stETH → wstETH`,
                  note: `Make sure stETH is approved for ${wstethAddr} first (use defi_token_approve with tokenAddress=${STETH_ADDRESS} and spender=${wstethAddr})`,
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

  private unwrapTxTool(): ToolDefinition {
    return {
      name: "defi_lido_unwrap_tx",
      description:
        "Build an unsigned transaction to unwrap wstETH back into stETH. Ethereum only.",
      inputSchema: z.object({
        amount: AmountSchema.describe("Amount of wstETH to unwrap"),
        userAddress: AddressSchema.describe(
          "Wallet address that will sign and send this transaction"
        ),
      }),
      handler: async (
        input: unknown,
        _context: PluginContext
      ): Promise<ToolResult> => {
        const { amount, userAddress } = input as {
          amount: string;
          userAddress: string;
        };

        const wstethAddr = WSTETH_ADDRESSES["ethereum"];
        const user = getAddress(userAddress);
        const rawAmount = parseUnits(amount, 18);

        const data = encodeFunctionData({
          abi: WSTETH_ABI,
          functionName: "unwrap",
          args: [rawAmount],
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  chainId: "ethereum",
                  ecosystem: "evm",
                  raw: {
                    to: wstethAddr,
                    data,
                    value: "0x0",
                    from: user,
                  },
                  description: `Unwrap ${amount} wstETH → stETH`,
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
