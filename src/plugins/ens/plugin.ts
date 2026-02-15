import { z } from "zod";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";

export class EnsPlugin implements DefiPlugin {
  readonly name = "ens";
  readonly description = "ENS name resolution and reverse lookups";
  readonly version = "1.0.0";

  async initialize(_context: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [
      {
        name: "defi_resolve_ens",
        description:
          "Resolve an ENS name (e.g. 'vitalik.eth') to an Ethereum address, or reverse-resolve an address to its ENS name.",
        inputSchema: z.object({
          nameOrAddress: z
            .string()
            .describe(
              "ENS name (e.g. 'vitalik.eth') or Ethereum address (0x...)"
            ),
        }),
        handler: async (
          input: unknown,
          context: PluginContext
        ): Promise<ToolResult> => {
          const { nameOrAddress } = input as { nameOrAddress: string };

          const rpcUrl =
            context.config.rpcUrls["ethereum"] ||
            "https://eth.llamarpc.com";
          const client = createPublicClient({
            chain: mainnet,
            transport: http(rpcUrl),
          });

          if (nameOrAddress.startsWith("0x")) {
            // Reverse resolve: address -> name
            const name = await client.getEnsName({
              address: nameOrAddress as `0x${string}`,
            });

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      address: nameOrAddress,
                      ensName: name || null,
                      resolved: !!name,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          } else {
            // Forward resolve: name -> address
            const address = await client.getEnsAddress({
              name: normalize(nameOrAddress),
            });

            let avatar: string | null = null;
            try {
              avatar = await client.getEnsAvatar({
                name: normalize(nameOrAddress),
              });
            } catch {}

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      ensName: nameOrAddress,
                      address: address || null,
                      avatar,
                      resolved: !!address,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          }
        },
      },
    ];
  }
}
