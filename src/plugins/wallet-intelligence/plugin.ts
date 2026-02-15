import { z } from "zod";
import { BasePlugin } from "../../core/base-plugin.js";
import type { ToolDefinition, ToolResult, PluginContext } from "../../core/types.js";
import type { ProtocolPosition } from "../../core/scanner-types.js";
import { AddressSchema } from "../../tools/schemas.js";

export class WalletIntelligencePlugin extends BasePlugin {
  readonly name = "wallet-intelligence";
  readonly description =
    "Comprehensive wallet scanning across all DeFi protocols and chains";
  readonly version = "1.0.0";
  readonly metadata = {
    tags: ["portfolio", "analytics", "multi-chain", "multi-protocol"],
  };

  getTools(): ToolDefinition[] {
    return [
      {
        name: "defi_wallet_scan",
        description:
          "Scan a wallet address for ALL DeFi positions across ALL supported protocols and chains. Returns native balances, ERC20 holdings, Aave V3 lending/borrowing positions, and Uniswap V3 LP positions, with aggregated USD values per protocol and chain.",
        inputSchema: z.object({
          address: AddressSchema.describe("Wallet address to scan"),
          chainIds: z
            .array(z.string())
            .optional()
            .describe(
              "Specific chains to scan. If omitted, scans all chains the address is valid on."
            ),
          protocols: z
            .array(z.string())
            .optional()
            .describe(
              'Specific protocols to scan (e.g. "Aave V3", "Uniswap V3"). If omitted, scans all.'
            ),
        }),
        handler: async (
          input: unknown,
          context: PluginContext
        ): Promise<ToolResult> => {
          const { address, chainIds, protocols } = input as {
            address: string;
            chainIds?: string[];
            protocols?: string[];
          };

          const scanners = context.getScanners();
          const allChains = context.getAllChains();

          // Determine chains to scan
          const chainsToScan = chainIds
            ? allChains.filter((c) => chainIds.includes(c.id))
            : allChains.filter((c) => {
                try {
                  return context
                    .getChainAdapterForChain(c.id)
                    .isValidAddress(c.id, address);
                } catch {
                  return false;
                }
              });

          // Filter scanners by protocol name if specified
          const activeScanners = protocols
            ? scanners.filter((s) =>
                protocols.some(
                  (p) =>
                    s.protocolName.toLowerCase() === p.toLowerCase()
                )
              )
            : scanners;

          // Execute all scans in parallel: scanner × chain
          const scanPromises: Promise<ProtocolPosition[]>[] = [];
          for (const scanner of activeScanners) {
            for (const chain of chainsToScan) {
              // NativeBalanceScanner has empty supportedChains — run on all
              const supported =
                scanner.supportedChains.length === 0 ||
                scanner.supportedChains.includes(chain.id);
              if (supported) {
                scanPromises.push(
                  scanner
                    .scanPositions(chain.id, address, context)
                    .catch(() => [])
                );
              }
            }
          }

          const results = (await Promise.all(scanPromises)).flat();

          // Aggregate by protocol
          const byProtocol: Record<
            string,
            { totalUsd: number; positionCount: number }
          > = {};
          // Aggregate by chain
          const byChain: Record<
            string,
            { chainName: string; totalUsd: number; positionCount: number }
          > = {};
          let grandTotal = 0;

          for (const pos of results) {
            // By protocol
            if (!byProtocol[pos.protocol]) {
              byProtocol[pos.protocol] = { totalUsd: 0, positionCount: 0 };
            }
            byProtocol[pos.protocol].totalUsd += pos.totalValueUsd;
            byProtocol[pos.protocol].positionCount++;

            // By chain
            if (!byChain[pos.chainId]) {
              byChain[pos.chainId] = {
                chainName: pos.chainName,
                totalUsd: 0,
                positionCount: 0,
              };
            }
            byChain[pos.chainId].totalUsd += pos.totalValueUsd;
            byChain[pos.chainId].positionCount++;

            grandTotal += pos.totalValueUsd;
          }

          // Format summary
          const protocolSummary = Object.fromEntries(
            Object.entries(byProtocol).map(([name, data]) => [
              name,
              {
                totalUsd: `$${data.totalUsd.toFixed(2)}`,
                positionCount: data.positionCount,
              },
            ])
          );

          const chainSummary = Object.fromEntries(
            Object.entries(byChain).map(([id, data]) => [
              id,
              {
                name: data.chainName,
                totalUsd: `$${data.totalUsd.toFixed(2)}`,
                positionCount: data.positionCount,
              },
            ])
          );

          return this.jsonResult({
            address,
            totalValueUsd: `$${grandTotal.toFixed(2)}`,
            protocolsScanned: activeScanners.map((s) => s.protocolName),
            chainsScanned: chainsToScan.map((c) => c.id),
            summary: {
              byProtocol: protocolSummary,
              byChain: chainSummary,
            },
            positions: results.map((p) => ({
              ...p,
              totalValueUsd: `$${p.totalValueUsd.toFixed(2)}`,
              assets: p.assets.map((a) => ({
                ...a,
                balanceUsd: `$${a.balanceUsd.toFixed(2)}`,
              })),
            })),
          });
        },
      },
    ];
  }
}
