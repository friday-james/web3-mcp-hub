import { z } from "zod";
import { createPublicClient, http, formatEther, formatGwei } from "viem";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";
import { ChainIdSchema } from "../../tools/schemas.js";

export class TxStatusPlugin implements DefiPlugin {
  readonly name = "tx-status";
  readonly description = "Transaction status and receipt lookups";
  readonly version = "1.0.0";

  async initialize(_context: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [
      {
        name: "defi_tx_status",
        description:
          "Check the status and details of a transaction by its hash. Returns confirmation status, gas used, block number, and decoded events for EVM and Solana chains.",
        inputSchema: z.object({
          chainId: ChainIdSchema,
          txHash: z.string().describe("Transaction hash to look up"),
        }),
        handler: async (
          input: unknown,
          context: PluginContext
        ): Promise<ToolResult> => {
          const { chainId, txHash } = input as {
            chainId: string;
            txHash: string;
          };

          const adapter = context.getChainAdapterForChain(chainId);
          const chain = adapter.getChain(chainId);
          if (!chain)
            return {
              content: [
                { type: "text", text: `Chain "${chainId}" not found` },
              ],
              isError: true,
            };

          if (chain.ecosystem === "evm") {
            return this.getEvmTxStatus(chainId, txHash, context);
          }

          if (chain.ecosystem === "solana") {
            return this.getSolanaTxStatus(chainId, txHash, context);
          }

          return {
            content: [
              {
                type: "text",
                text: `Transaction lookup not yet supported for ${chain.ecosystem}`,
              },
            ],
          };
        },
      },
    ];
  }

  private async getEvmTxStatus(
    chainId: string,
    txHash: string,
    context: PluginContext
  ): Promise<ToolResult> {
    const adapter = context.getChainAdapterForChain(chainId);
    const chain = adapter.getChain(chainId)!;
    const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
    const client = createPublicClient({ transport: http(rpcUrl) });

    const [tx, receipt] = await Promise.all([
      client.getTransaction({ hash: txHash as `0x${string}` }),
      client
        .getTransactionReceipt({ hash: txHash as `0x${string}` })
        .catch(() => null),
    ]);

    const result: Record<string, unknown> = {
      chain: chain.name,
      hash: txHash,
      status: receipt
        ? receipt.status === "success"
          ? "confirmed"
          : "reverted"
        : "pending",
      from: tx.from,
      to: tx.to,
      value: formatEther(tx.value) + " " + chain.nativeToken.symbol,
      blockNumber: receipt?.blockNumber?.toString(),
      gasUsed: receipt?.gasUsed?.toString(),
      effectiveGasPrice: receipt?.effectiveGasPrice
        ? formatGwei(receipt.effectiveGasPrice) + " gwei"
        : undefined,
      nonce: tx.nonce,
      explorerUrl: chain.explorerUrl
        ? `${chain.explorerUrl}/tx/${txHash}`
        : undefined,
    };

    return {
      content: [
        { type: "text", text: JSON.stringify(result, null, 2) },
      ],
    };
  }

  private async getSolanaTxStatus(
    chainId: string,
    txHash: string,
    context: PluginContext
  ): Promise<ToolResult> {
    const { Connection } = await import("@solana/web3.js");
    const adapter = context.getChainAdapterForChain(chainId);
    const chain = adapter.getChain(chainId)!;
    const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
    const connection = new Connection(rpcUrl, "confirmed");

    const tx = await connection.getTransaction(txHash, {
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                chain: chain.name,
                hash: txHash,
                status: "not_found",
                message: "Transaction not found or not yet confirmed",
              },
              null,
              2
            ),
          },
        ],
      };
    }

    const result = {
      chain: chain.name,
      hash: txHash,
      status: tx.meta?.err ? "failed" : "confirmed",
      error: tx.meta?.err
        ? JSON.stringify(tx.meta.err)
        : undefined,
      slot: tx.slot,
      blockTime: tx.blockTime
        ? new Date(tx.blockTime * 1000).toISOString()
        : undefined,
      fee: `${(tx.meta?.fee || 0) / 1e9} SOL`,
      computeUnitsConsumed:
        tx.meta?.computeUnitsConsumed?.toString(),
      explorerUrl: `https://solscan.io/tx/${txHash}`,
    };

    return {
      content: [
        { type: "text", text: JSON.stringify(result, null, 2) },
      ],
    };
  }
}
