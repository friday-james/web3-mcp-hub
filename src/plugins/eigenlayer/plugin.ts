import { z } from "zod";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";
import { AddressSchema } from "../../tools/schemas.js";

const EIGENLAYER_API = "https://api.eigenexplorer.com";

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function errorResult(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }], isError: true };
}

export class EigenLayerPlugin implements DefiPlugin {
  readonly name = "eigenlayer";
  readonly description = "EigenLayer restaking: operators, AVS, and staker info";
  readonly version = "1.0.0";

  async initialize(_ctx: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [this.operatorsTool(), this.stakerTool()];
  }

  private operatorsTool(): ToolDefinition {
    return {
      name: "defi_eigenlayer_operators",
      description:
        "List top EigenLayer operators by TVL. Shows delegated ETH, number of stakers, and AVS count.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).optional().describe("Number of results (default 20)"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { limit = 20 } = input as { limit?: number };

          const res = await fetch(
            `${EIGENLAYER_API}/operators?skip=0&take=${limit}&sortByTvl=desc`
          );
          if (!res.ok) throw new Error(`EigenLayer API ${res.status}`);
          const data = await res.json();

          const operators = (data.data || data || []).map((op: any) => ({
            name: op.metadataName || op.metadata?.name,
            address: op.address,
            tvlEth: op.tvl?.eth,
            stakers: op.stakerCount || op.totalStakers,
            avsCount: op.avsCount || op.totalAvs,
          }));

          return jsonResult({ count: operators.length, operators });
        } catch (e: any) {
          return errorResult(`Failed to fetch EigenLayer operators: ${e.message}`);
        }
      },
    };
  }

  private stakerTool(): ToolDefinition {
    return {
      name: "defi_eigenlayer_staker",
      description:
        "Get EigenLayer restaking info for a specific address: delegated operator, restaked amount, withdrawal status.",
      inputSchema: z.object({
        address: AddressSchema.describe("Staker wallet address"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { address } = input as { address: string };

          const res = await fetch(`${EIGENLAYER_API}/stakers/${address}`);
          if (!res.ok) {
            if (res.status === 404) return jsonResult({ address, restaked: false, message: "No EigenLayer positions found" });
            throw new Error(`EigenLayer API ${res.status}`);
          }
          const data = await res.json();

          return jsonResult({
            address,
            restaked: true,
            operator: data.operator?.address,
            operatorName: data.operator?.metadataName || data.operator?.metadata?.name,
            shares: data.shares,
            withdrawals: data.withdrawals,
          });
        } catch (e: any) {
          return errorResult(`Failed to fetch staker info: ${e.message}`);
        }
      },
    };
  }
}
