import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Registry } from "../core/registry.js";

/**
 * Registers all tools from all plugins onto the McpServer instance.
 * Also registers built-in tools like defi_get_chains.
 */
export function registerAllTools(
  server: McpServer,
  registry: Registry
): void {
  const context = registry.getPluginContext();

  // Built-in: list supported chains
  server.tool(
    "defi_get_chains",
    "List all supported blockchain networks with their IDs, names, ecosystems, and native tokens.",
    {},
    async () => {
      const chains = registry.getSupportedChains();
      const summary = chains.map((c) => ({
        id: c.id,
        name: c.name,
        ecosystem: c.ecosystem,
        nativeToken: c.nativeToken.symbol,
        explorer: c.explorerUrl,
      }));
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(summary, null, 2) },
        ],
      };
    }
  );

  // Register all plugin tools
  const tools = registry.getAllTools();
  for (const tool of tools) {
    const shape =
      tool.inputSchema instanceof z.ZodObject
        ? (tool.inputSchema as z.ZodObject<z.ZodRawShape>).shape
        : {};

    server.tool(
      tool.name,
      tool.description,
      shape,
      async (input) => {
        try {
          const result = await tool.handler(input, context);
          return {
            content: result.content,
            isError: result.isError,
          };
        } catch (err) {
          const message =
            err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text" as const, text: `Error: ${message}` }],
            isError: true,
          };
        }
      }
    );
  }
}
