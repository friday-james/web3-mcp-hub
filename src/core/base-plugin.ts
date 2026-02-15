import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
  ChainInfo,
} from "./types.js";

/**
 * Optional base class for plugins. Stores context during initialize()
 * and provides helper methods. Existing plugins don't need to change.
 */
export abstract class BasePlugin implements DefiPlugin {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly version: string;

  protected context!: PluginContext;

  async initialize(context: PluginContext): Promise<void> {
    this.context = context;
  }

  abstract getTools(): ToolDefinition[];

  /** Helper: create a success ToolResult from an object */
  protected jsonResult(data: unknown): ToolResult {
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  /** Helper: create an error ToolResult */
  protected errorResult(message: string): ToolResult {
    return {
      content: [{ type: "text", text: message }],
      isError: true,
    };
  }

  /** Helper: get all chains valid for an address */
  protected getChainsForAddress(address: string): ChainInfo[] {
    return this.context.getAllChains().filter((chain) => {
      try {
        return this.context
          .getChainAdapterForChain(chain.id)
          .isValidAddress(chain.id, address);
      } catch {
        return false;
      }
    });
  }
}
