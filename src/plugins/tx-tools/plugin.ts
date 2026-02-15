import { z } from "zod";
import {
  createPublicClient,
  http,
  getAddress,
  formatEther,
  formatGwei,
  parseEther,
} from "viem";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";
import { ChainIdSchema, AddressSchema } from "../../tools/schemas.js";

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function errorResult(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }], isError: true };
}

export class TxToolsPlugin implements DefiPlugin {
  readonly name = "tx-tools";
  readonly description = "Transaction utilities: gas estimation, block info, and nonce management";
  readonly version = "1.0.0";

  async initialize(_ctx: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [
      this.estimateGasTool(),
      this.blockInfoTool(),
      this.nonceTool(),
    ];
  }

  private estimateGasTool(): ToolDefinition {
    return {
      name: "defi_estimate_gas",
      description:
        "Estimate gas cost for an arbitrary transaction. Provide the raw transaction data (to, data, value) and get back the estimated gas units and cost in native token.",
      inputSchema: z.object({
        chainId: ChainIdSchema,
        to: AddressSchema.describe("Transaction target address"),
        data: z.string().optional().describe("Transaction calldata (hex)"),
        value: z.string().optional().describe('Value to send in ETH (e.g. "0.1")'),
        from: AddressSchema.optional().describe("Sender address (optional, uses zero address if omitted)"),
      }),
      handler: async (input: unknown, context: PluginContext): Promise<ToolResult> => {
        try {
          const { chainId, to, data, value, from } = input as {
            chainId: string; to: string; data?: string; value?: string; from?: string;
          };

          const adapter = context.getChainAdapterForChain(chainId);
          const chain = adapter.getChain(chainId);
          if (!chain || chain.ecosystem !== "evm") {
            return errorResult("Gas estimation only supported on EVM chains");
          }

          const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
          const client = createPublicClient({ transport: http(rpcUrl) });

          const txRequest: any = { to: getAddress(to) };
          if (data) txRequest.data = data as `0x${string}`;
          if (value) txRequest.value = parseEther(value);
          if (from) txRequest.from = getAddress(from) as `0x${string}`;

          const [gasEstimate, gasPrice, block] = await Promise.all([
            client.estimateGas(txRequest),
            client.getGasPrice(),
            client.getBlock({ blockTag: "latest" }),
          ]);

          const gasCost = gasEstimate * gasPrice;
          const baseFee = block.baseFeePerGas;

          return jsonResult({
            chain: chainId,
            gasUnits: gasEstimate.toString(),
            gasPrice: `${formatGwei(gasPrice)} gwei`,
            estimatedCost: `${formatEther(gasCost)} ${chain.nativeToken.symbol}`,
            baseFee: baseFee ? `${formatGwei(baseFee)} gwei` : undefined,
            blockNumber: block.number?.toString(),
          });
        } catch (e: any) {
          return errorResult(`Gas estimation failed: ${e.message}`);
        }
      },
    };
  }

  private blockInfoTool(): ToolDefinition {
    return {
      name: "defi_block_info",
      description:
        "Get information about the latest block or a specific block on an EVM chain. Returns block number, timestamp, gas used, and transaction count.",
      inputSchema: z.object({
        chainId: ChainIdSchema,
        blockNumber: z.string().optional().describe('Block number or "latest" (default: latest)'),
      }),
      handler: async (input: unknown, context: PluginContext): Promise<ToolResult> => {
        try {
          const { chainId, blockNumber } = input as { chainId: string; blockNumber?: string };

          const adapter = context.getChainAdapterForChain(chainId);
          const chain = adapter.getChain(chainId);
          if (!chain || chain.ecosystem !== "evm") {
            return errorResult("Block info only supported on EVM chains");
          }

          const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
          const client = createPublicClient({ transport: http(rpcUrl) });

          const blockTag = blockNumber && blockNumber !== "latest"
            ? { blockNumber: BigInt(blockNumber) }
            : { blockTag: "latest" as const };

          const block = await client.getBlock(blockTag);

          return jsonResult({
            chain: chainId,
            blockNumber: block.number?.toString(),
            timestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
            hash: block.hash,
            parentHash: block.parentHash,
            gasUsed: block.gasUsed.toString(),
            gasLimit: block.gasLimit.toString(),
            baseFeePerGas: block.baseFeePerGas ? `${formatGwei(block.baseFeePerGas)} gwei` : undefined,
            transactionCount: block.transactions.length,
            miner: block.miner,
          });
        } catch (e: any) {
          return errorResult(`Failed to get block info: ${e.message}`);
        }
      },
    };
  }

  private nonceTool(): ToolDefinition {
    return {
      name: "defi_get_nonce",
      description:
        "Get the current transaction nonce for an address. Useful for building transactions manually or detecting stuck transactions.",
      inputSchema: z.object({
        chainId: ChainIdSchema,
        address: AddressSchema.describe("Wallet address to check"),
      }),
      handler: async (input: unknown, context: PluginContext): Promise<ToolResult> => {
        try {
          const { chainId, address } = input as { chainId: string; address: string };

          const adapter = context.getChainAdapterForChain(chainId);
          const chain = adapter.getChain(chainId);
          if (!chain || chain.ecosystem !== "evm") {
            return errorResult("Nonce check only supported on EVM chains");
          }

          const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
          const client = createPublicClient({ transport: http(rpcUrl) });

          const [confirmed, pending] = await Promise.all([
            client.getTransactionCount({ address: getAddress(address) }),
            client.getTransactionCount({ address: getAddress(address), blockTag: "pending" }),
          ]);

          return jsonResult({
            chain: chainId,
            address,
            confirmedNonce: confirmed,
            pendingNonce: pending,
            pendingTxCount: pending - confirmed,
            note: pending > confirmed
              ? `${pending - confirmed} pending transaction(s) detected`
              : "No pending transactions",
          });
        } catch (e: any) {
          return errorResult(`Failed to get nonce: ${e.message}`);
        }
      },
    };
  }
}
