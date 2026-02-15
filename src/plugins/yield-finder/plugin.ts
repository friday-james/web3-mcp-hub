import { z } from "zod";
import { BasePlugin } from "../../core/base-plugin.js";
import type { ToolDefinition, ToolResult, PluginContext } from "../../core/types.js";
import type { YieldOpportunity } from "../../core/yield-types.js";
import { AmountSchema } from "../../tools/schemas.js";
import { estimateGasCostUsd, estimateBridgeCostUsd } from "./cost-estimator.js";

export class YieldFinderPlugin extends BasePlugin {
  readonly name = "yield-finder";
  readonly description =
    "Find optimal yield across all DeFi protocols and chains";
  readonly version = "1.0.0";
  readonly metadata = {
    tags: ["yield", "optimization", "intent", "cross-chain"],
  };

  getTools(): ToolDefinition[] {
    return [
      {
        name: "defi_find_best_yield",
        description:
          "Find the best yield opportunities for a token across all supported protocols and chains. Compares Aave V3 supply APY across Ethereum, Base, Arbitrum, Polygon, Optimism, and Avalanche. Factors in gas costs and bridge costs to calculate net APY. Returns a ranked list with execution steps.",
        inputSchema: z.object({
          token: z
            .string()
            .describe('Token symbol (e.g. "USDC", "ETH", "DAI")'),
          amount: AmountSchema.describe(
            'Amount to deposit (e.g. "10000")'
          ),
          currentChainId: z
            .string()
            .optional()
            .describe(
              "Chain where funds currently are. Used to calculate bridge costs for cross-chain opportunities."
            ),
          riskTolerance: z
            .enum(["low", "medium", "high"])
            .optional()
            .describe("Risk tolerance level. Defaults to medium."),
          timeHorizonDays: z
            .number()
            .optional()
            .describe(
              "Investment time horizon in days for net APY calculation. Defaults to 365."
            ),
        }),
        handler: async (
          input: unknown,
          context: PluginContext
        ): Promise<ToolResult> => {
          const {
            token,
            amount,
            currentChainId,
            riskTolerance = "medium",
            timeHorizonDays = 365,
          } = input as {
            token: string;
            amount: string;
            currentChainId?: string;
            riskTolerance?: "low" | "medium" | "high";
            timeHorizonDays?: number;
          };

          const yieldSources = context.getYieldSources();
          const amountNum = parseFloat(amount);

          if (amountNum <= 0) {
            return this.errorResult("Amount must be greater than 0");
          }

          // Gather all opportunities in parallel
          const allOpportunities = (
            await Promise.all(
              yieldSources.map((source) =>
                source
                  .getYieldOpportunities(token, context)
                  .catch(() => [])
              )
            )
          ).flat();

          if (allOpportunities.length === 0) {
            return this.jsonResult({
              token,
              amount,
              message: `No yield opportunities found for ${token}. Make sure the token is available on supported lending protocols.`,
              opportunitiesFound: 0,
            });
          }

          // Filter by risk tolerance
          const riskOrder = { low: 0, medium: 1, high: 2 };
          const filtered = allOpportunities.filter(
            (opp) => riskOrder[opp.riskLevel] <= riskOrder[riskTolerance]
          );

          // Calculate net APY for each opportunity in parallel
          const ranked = await Promise.all(
            filtered.map(async (opp) => {
              // Gas cost for approve + supply
              const gasCostUsd = await estimateGasCostUsd(
                opp.chainId,
                "erc20_approve",
                context
              ).catch(() => 0) +
                await estimateGasCostUsd(
                  opp.chainId,
                  "aave_supply",
                  context
                ).catch(() => 0);

              // Bridge cost if cross-chain
              const bridgeCostUsd =
                currentChainId && currentChainId !== opp.chainId
                  ? await estimateBridgeCostUsd(
                      currentChainId,
                      opp.chainId,
                      token,
                      amount,
                      context
                    ).catch(() => 0)
                  : 0;

              const totalEntryCost = gasCostUsd + bridgeCostUsd;
              const grossYield =
                amountNum * (opp.apy / 100) * (timeHorizonDays / 365);
              const netYield = grossYield - totalEntryCost;
              const netApy =
                (netYield / amountNum) * 100 * (365 / timeHorizonDays);

              // Build execution steps
              const steps: string[] = [];
              if (currentChainId && currentChainId !== opp.chainId) {
                steps.push(
                  `Bridge ${amount} ${token} from ${currentChainId} to ${opp.chainId} (use defi_bridge_quote)`
                );
              }
              steps.push(
                `Approve ${token} for Aave V3 pool on ${opp.chainId} (use defi_token_approve)`
              );
              steps.push(
                `Supply ${amount} ${token} to ${opp.protocol} on ${opp.chainId} (use defi_lending_supply_tx)`
              );

              return {
                protocol: opp.protocol,
                chainId: opp.chainId,
                chainName: opp.chainName,
                asset: opp.asset,
                category: opp.category,
                riskLevel: opp.riskLevel,
                grossApy: `${opp.apy.toFixed(2)}%`,
                gasCostUsd: `$${gasCostUsd.toFixed(2)}`,
                bridgeCostUsd: `$${bridgeCostUsd.toFixed(2)}`,
                totalEntryCostUsd: `$${totalEntryCost.toFixed(2)}`,
                netApy: `${netApy.toFixed(2)}%`,
                estimatedGrossYieldUsd: `$${grossYield.toFixed(2)}`,
                estimatedNetYieldUsd: `$${netYield.toFixed(2)}`,
                tvl: opp.tvl
                  ? `$${(opp.tvl / 1e6).toFixed(1)}M`
                  : undefined,
                executionSteps: steps,
                metadata: opp.metadata,
              };
            })
          );

          // Sort by net APY descending
          ranked.sort(
            (a, b) =>
              parseFloat(b.netApy) - parseFloat(a.netApy)
          );

          return this.jsonResult({
            token,
            amount,
            currentChainId: currentChainId ?? "not specified",
            timeHorizonDays,
            riskTolerance,
            opportunitiesFound: ranked.length,
            bestOpportunity: ranked[0] ?? null,
            allOpportunities: ranked,
          });
        },
      },
    ];
  }
}
