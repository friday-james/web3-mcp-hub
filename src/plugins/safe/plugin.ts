import { z } from "zod";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";
import { ChainIdSchema, AddressSchema } from "../../tools/schemas.js";

const SAFE_API_MAP: Record<string, string> = {
  ethereum: "https://safe-transaction-mainnet.safe.global/api/v1",
  polygon: "https://safe-transaction-polygon.safe.global/api/v1",
  arbitrum: "https://safe-transaction-arbitrum.safe.global/api/v1",
  optimism: "https://safe-transaction-optimism.safe.global/api/v1",
  base: "https://safe-transaction-base.safe.global/api/v1",
  avalanche: "https://safe-transaction-avalanche.safe.global/api/v1",
  bsc: "https://safe-transaction-bsc.safe.global/api/v1",
};

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function errorResult(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }], isError: true };
}

export class SafePlugin implements DefiPlugin {
  readonly name = "safe";
  readonly description = "Gnosis Safe multisig: wallet info, pending transactions, balances";
  readonly version = "1.0.0";

  async initialize(_ctx: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [this.infoTool(), this.transactionsTool(), this.balancesTool()];
  }

  private infoTool(): ToolDefinition {
    return {
      name: "defi_safe_info",
      description: `Get Safe multisig wallet info: owners, threshold, nonce, modules. Supported chains: ${Object.keys(SAFE_API_MAP).join(", ")}.`,
      inputSchema: z.object({
        chainId: ChainIdSchema,
        safeAddress: AddressSchema.describe("Safe multisig address"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { chainId, safeAddress } = input as { chainId: string; safeAddress: string };
          const api = SAFE_API_MAP[chainId];
          if (!api) return errorResult(`Safe not available on "${chainId}"`);

          const res = await fetch(`${api}/safes/${safeAddress}/`);
          if (!res.ok) throw new Error(`Safe API ${res.status}`);
          const data = await res.json();

          return jsonResult({
            chain: chainId,
            address: data.address,
            owners: data.owners,
            threshold: data.threshold,
            nonce: data.nonce,
            modules: data.modules,
            fallbackHandler: data.fallbackHandler,
            version: data.version,
          });
        } catch (e: any) {
          return errorResult(`Failed to fetch Safe info: ${e.message}`);
        }
      },
    };
  }

  private transactionsTool(): ToolDefinition {
    return {
      name: "defi_safe_transactions",
      description:
        "List pending and recent transactions for a Safe multisig wallet.",
      inputSchema: z.object({
        chainId: ChainIdSchema,
        safeAddress: AddressSchema.describe("Safe multisig address"),
        limit: z.number().int().min(1).max(20).optional().describe("Number of results (default 10)"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { chainId, safeAddress, limit = 10 } = input as {
            chainId: string; safeAddress: string; limit?: number;
          };
          const api = SAFE_API_MAP[chainId];
          if (!api) return errorResult(`Safe not available on "${chainId}"`);

          // Get pending (queued) transactions
          const [queuedRes, historyRes] = await Promise.all([
            fetch(`${api}/safes/${safeAddress}/multisig-transactions/?executed=false&limit=${limit}`),
            fetch(`${api}/safes/${safeAddress}/multisig-transactions/?executed=true&limit=${limit}`),
          ]);

          const queued = queuedRes.ok ? await queuedRes.json() : { results: [] };
          const history = historyRes.ok ? await historyRes.json() : { results: [] };

          const formatTx = (tx: any) => ({
            safeTxHash: tx.safeTxHash,
            to: tx.to,
            value: tx.value,
            operation: tx.operation === 1 ? "delegatecall" : "call",
            nonce: tx.nonce,
            confirmations: tx.confirmations?.length || 0,
            confirmationsRequired: tx.confirmationsRequired,
            executed: tx.isExecuted,
            submissionDate: tx.submissionDate,
            executionDate: tx.executionDate,
          });

          return jsonResult({
            chain: chainId,
            safe: safeAddress,
            pending: (queued.results || []).slice(0, limit).map(formatTx),
            recent: (history.results || []).slice(0, limit).map(formatTx),
          });
        } catch (e: any) {
          return errorResult(`Failed to fetch Safe transactions: ${e.message}`);
        }
      },
    };
  }

  private balancesTool(): ToolDefinition {
    return {
      name: "defi_safe_balances",
      description: "Get token balances for a Safe multisig wallet with USD values.",
      inputSchema: z.object({
        chainId: ChainIdSchema,
        safeAddress: AddressSchema.describe("Safe multisig address"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { chainId, safeAddress } = input as { chainId: string; safeAddress: string };
          const api = SAFE_API_MAP[chainId];
          if (!api) return errorResult(`Safe not available on "${chainId}"`);

          const res = await fetch(`${api}/safes/${safeAddress}/balances/usd/`);
          if (!res.ok) throw new Error(`Safe API ${res.status}`);
          const data = await res.json();

          let totalUsd = 0;
          const balances = (data as any[]).map((b) => {
            const usd = Number(b.fiatBalance) || 0;
            totalUsd += usd;
            return {
              token: b.token?.symbol || "ETH",
              address: b.tokenAddress,
              balance: b.balance,
              balanceUsd: usd,
            };
          });

          return jsonResult({
            chain: chainId,
            safe: safeAddress,
            totalUsd,
            balances,
          });
        } catch (e: any) {
          return errorResult(`Failed to fetch Safe balances: ${e.message}`);
        }
      },
    };
  }
}
