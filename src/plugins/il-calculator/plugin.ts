import { z } from "zod";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export class ILCalculatorPlugin implements DefiPlugin {
  readonly name = "il-calculator";
  readonly description = "Impermanent loss calculator for AMM liquidity positions";
  readonly version = "1.0.0";

  async initialize(_ctx: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [this.calculateILTool(), this.compareStrategiesTool()];
  }

  private calculateILTool(): ToolDefinition {
    return {
      name: "defi_impermanent_loss",
      description:
        "Calculate impermanent loss for a liquidity pool position. Shows the loss compared to simply holding the tokens. Essential for evaluating whether LP fees justify the IL risk.",
      inputSchema: z.object({
        token0Symbol: z.string().describe("First token symbol (e.g. ETH)"),
        token1Symbol: z.string().describe("Second token symbol (e.g. USDC)"),
        entryPrice: z
          .number()
          .positive()
          .describe("Price of token0 in terms of token1 when you entered the position"),
        currentPrice: z
          .number()
          .positive()
          .describe("Current price of token0 in terms of token1"),
        investmentUsd: z
          .number()
          .positive()
          .optional()
          .describe("Total investment in USD (optional, for dollar amounts)"),
        feesEarnedUsd: z
          .number()
          .min(0)
          .optional()
          .describe("Total fees earned in USD (optional, to calculate net outcome)"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const {
          token0Symbol,
          token1Symbol,
          entryPrice,
          currentPrice,
          investmentUsd,
          feesEarnedUsd = 0,
        } = input as {
          token0Symbol: string;
          token1Symbol: string;
          entryPrice: number;
          currentPrice: number;
          investmentUsd?: number;
          feesEarnedUsd?: number;
        };

        // IL formula: IL = 2 * sqrt(r) / (1 + r) - 1
        // where r = currentPrice / entryPrice
        const r = currentPrice / entryPrice;
        const sqrtR = Math.sqrt(r);
        const ilFraction = 2 * sqrtR / (1 + r) - 1;
        const ilPercent = ilFraction * 100;

        // Value comparison
        // LP value = investment * (2 * sqrt(r) / (1 + r))
        // HODL value = investment * (1 + r) / 2 (equal split)
        const lpMultiplier = 2 * sqrtR / (1 + r);
        const hodlMultiplier = (1 + r) / 2;

        const priceChange = ((currentPrice - entryPrice) / entryPrice) * 100;

        const result: any = {
          pair: `${token0Symbol}/${token1Symbol}`,
          entryPrice: `1 ${token0Symbol} = ${entryPrice} ${token1Symbol}`,
          currentPrice: `1 ${token0Symbol} = ${currentPrice} ${token1Symbol}`,
          priceChange: `${priceChange >= 0 ? "+" : ""}${priceChange.toFixed(2)}%`,
          impermanentLoss: {
            percent: `${ilPercent.toFixed(4)}%`,
            description:
              ilPercent === 0
                ? "No impermanent loss (price unchanged)"
                : `LP position is worth ${Math.abs(ilPercent).toFixed(2)}% less than holding`,
          },
          valueComparison: {
            lpValue: `${(lpMultiplier * 100).toFixed(2)}% of initial`,
            hodlValue: `${(hodlMultiplier * 100).toFixed(2)}% of initial`,
          },
        };

        if (investmentUsd) {
          const lpValueUsd = investmentUsd * lpMultiplier;
          const hodlValueUsd = investmentUsd * hodlMultiplier;
          const ilUsd = lpValueUsd - hodlValueUsd;
          const netPnl = lpValueUsd + feesEarnedUsd - investmentUsd;

          result.dollarAmounts = {
            investment: `$${investmentUsd.toFixed(2)}`,
            lpValueNow: `$${lpValueUsd.toFixed(2)}`,
            hodlValueNow: `$${hodlValueUsd.toFixed(2)}`,
            ilLoss: `$${ilUsd.toFixed(2)}`,
            feesEarned: `$${feesEarnedUsd.toFixed(2)}`,
            netPnl: `${netPnl >= 0 ? "+" : ""}$${netPnl.toFixed(2)}`,
            feesCoverIL: feesEarnedUsd >= Math.abs(ilUsd),
          };

          if (feesEarnedUsd > 0) {
            result.verdict =
              feesEarnedUsd >= Math.abs(ilUsd)
                ? `Fees ($${feesEarnedUsd.toFixed(2)}) exceed IL ($${Math.abs(ilUsd).toFixed(2)}). LP position is profitable.`
                : `IL ($${Math.abs(ilUsd).toFixed(2)}) exceeds fees ($${feesEarnedUsd.toFixed(2)}). Would have been better to hold.`;
          }
        }

        // Show IL at different price scenarios
        result.scenarios = [
          { change: "-50%", il: this.calcIL(0.5) },
          { change: "-25%", il: this.calcIL(0.75) },
          { change: "-10%", il: this.calcIL(0.9) },
          { change: "0%", il: "0.00%" },
          { change: "+10%", il: this.calcIL(1.1) },
          { change: "+25%", il: this.calcIL(1.25) },
          { change: "+50%", il: this.calcIL(1.5) },
          { change: "+100%", il: this.calcIL(2.0) },
          { change: "+200%", il: this.calcIL(3.0) },
          { change: "+500%", il: this.calcIL(6.0) },
        ];

        return jsonResult(result);
      },
    };
  }

  private calcIL(r: number): string {
    const il = (2 * Math.sqrt(r) / (1 + r) - 1) * 100;
    return `${il.toFixed(2)}%`;
  }

  private compareStrategiesTool(): ToolDefinition {
    return {
      name: "defi_yield_vs_hold",
      description:
        "Compare the outcome of providing liquidity (with fees and IL) versus simply holding tokens, versus lending on Aave/Compound. Helps users decide the best strategy for their tokens.",
      inputSchema: z.object({
        token0Symbol: z.string().describe("First token (e.g. ETH)"),
        token1Symbol: z.string().describe("Second token (e.g. USDC)"),
        investmentUsd: z.number().positive().describe("Total investment in USD"),
        daysHeld: z.number().int().positive().describe("Number of days"),
        priceChangePercent: z
          .number()
          .describe("Expected price change of token0 in percent (e.g. 20 for +20%)"),
        lpAprPercent: z
          .number()
          .min(0)
          .describe("LP pool APR from fees (e.g. 15 for 15%)"),
        lendingAprPercent: z
          .number()
          .min(0)
          .optional()
          .describe("Lending APR if available (e.g. 5 for 5%)"),
        stakingAprPercent: z
          .number()
          .min(0)
          .optional()
          .describe("Staking APR if available (e.g. 3.5 for 3.5%)"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const {
          token0Symbol,
          token1Symbol,
          investmentUsd,
          daysHeld,
          priceChangePercent,
          lpAprPercent,
          lendingAprPercent,
          stakingAprPercent,
        } = input as {
          token0Symbol: string;
          token1Symbol: string;
          investmentUsd: number;
          daysHeld: number;
          priceChangePercent: number;
          lpAprPercent: number;
          lendingAprPercent?: number;
          stakingAprPercent?: number;
        };

        const r = 1 + priceChangePercent / 100;
        const dayFraction = daysHeld / 365;

        // Strategy 1: HODL (50/50 split)
        const hodlMultiplier = (1 + r) / 2;
        const hodlValue = investmentUsd * hodlMultiplier;

        // Strategy 2: LP (with IL + fees)
        const lpMultiplier = 2 * Math.sqrt(r) / (1 + r);
        const fees = investmentUsd * (lpAprPercent / 100) * dayFraction;
        const lpValue = investmentUsd * lpMultiplier + fees;

        // Strategy 3: Lending
        const lendingValue = lendingAprPercent
          ? investmentUsd * (1 + (lendingAprPercent / 100) * dayFraction)
          : null;

        // Strategy 4: Staking
        const stakingValue = stakingAprPercent
          ? investmentUsd * (1 + (stakingAprPercent / 100) * dayFraction)
          : null;

        const strategies: any[] = [
          {
            strategy: `HODL 50/50 (${token0Symbol}/${token1Symbol})`,
            finalValue: `$${hodlValue.toFixed(2)}`,
            pnl: `${hodlValue >= investmentUsd ? "+" : ""}$${(hodlValue - investmentUsd).toFixed(2)}`,
            returnPercent: `${((hodlValue / investmentUsd - 1) * 100).toFixed(2)}%`,
          },
          {
            strategy: `LP (${token0Symbol}/${token1Symbol} @ ${lpAprPercent}% APR)`,
            finalValue: `$${lpValue.toFixed(2)}`,
            pnl: `${lpValue >= investmentUsd ? "+" : ""}$${(lpValue - investmentUsd).toFixed(2)}`,
            returnPercent: `${((lpValue / investmentUsd - 1) * 100).toFixed(2)}%`,
            breakdown: {
              positionValue: `$${(investmentUsd * lpMultiplier).toFixed(2)}`,
              feesEarned: `$${fees.toFixed(2)}`,
              impermanentLoss: `$${((lpMultiplier - hodlMultiplier) * investmentUsd).toFixed(2)}`,
            },
          },
        ];

        if (lendingValue) {
          strategies.push({
            strategy: `Lend (${lendingAprPercent}% APR)`,
            finalValue: `$${lendingValue.toFixed(2)}`,
            pnl: `+$${(lendingValue - investmentUsd).toFixed(2)}`,
            returnPercent: `${((lendingValue / investmentUsd - 1) * 100).toFixed(2)}%`,
          });
        }

        if (stakingValue) {
          strategies.push({
            strategy: `Stake (${stakingAprPercent}% APR)`,
            finalValue: `$${stakingValue.toFixed(2)}`,
            pnl: `+$${(stakingValue - investmentUsd).toFixed(2)}`,
            returnPercent: `${((stakingValue / investmentUsd - 1) * 100).toFixed(2)}%`,
          });
        }

        // Sort by final value
        strategies.sort(
          (a, b) =>
            parseFloat(b.finalValue.replace("$", "")) -
            parseFloat(a.finalValue.replace("$", ""))
        );

        return jsonResult({
          scenario: {
            pair: `${token0Symbol}/${token1Symbol}`,
            investment: `$${investmentUsd.toFixed(2)}`,
            timeframe: `${daysHeld} days`,
            priceChange: `${priceChangePercent >= 0 ? "+" : ""}${priceChangePercent}%`,
          },
          bestStrategy: strategies[0].strategy,
          strategies,
        });
      },
    };
  }
}
