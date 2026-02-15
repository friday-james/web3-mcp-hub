import { z } from "zod";
import {
  encodeFunctionData,
  getAddress,
  parseEther,
  maxUint256,
} from "viem";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";
import { ChainIdSchema, AddressSchema, AmountSchema } from "../../tools/schemas.js";
import { parseTokenAmount } from "../../core/utils.js";

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function errorResult(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }], isError: true };
}

// Aave V3 Pool addresses
const AAVE_V3_POOL: Record<string, string> = {
  ethereum: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
  arbitrum: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  optimism: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  polygon: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  base: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
};

const POOL_ABI = [
  {
    name: "supply",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
      { name: "referralCode", type: "uint16" },
    ],
    outputs: [],
  },
  {
    name: "borrow",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "interestRateMode", type: "uint256" },
      { name: "referralCode", type: "uint16" },
      { name: "onBehalfOf", type: "address" },
    ],
    outputs: [],
  },
] as const;

const SUPPORTED = Object.keys(AAVE_V3_POOL);

export class LeveragePlugin implements DefiPlugin {
  readonly name = "leverage";
  readonly description =
    "Leverage strategies: loop borrowing on Aave, flash loan arb routes, and position sizing";
  readonly version = "1.0.0";

  async initialize(_ctx: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [
      this.leverageLoopPlanTool(),
      this.leverageLoopBuildTool(),
      this.positionSizeTool(),
    ];
  }

  private leverageLoopPlanTool(): ToolDefinition {
    return {
      name: "defi_leverage_loop_plan",
      description: `Plan a leverage loop strategy on Aave V3. Calculates the number of loops, final position size, effective APY, liquidation price, and health factor at each step. Supply asset → borrow against it → supply again → repeat. Supported chains: ${SUPPORTED.join(", ")}.`,
      inputSchema: z.object({
        chainId: ChainIdSchema,
        supplyAsset: z.string().describe('Asset to supply (e.g. "wstETH", "ETH")'),
        borrowAsset: z.string().describe('Asset to borrow (e.g. "ETH", "USDC")'),
        initialAmount: z.string().describe("Initial amount to supply"),
        loops: z.number().int().min(1).max(10).describe("Number of leverage loops (1-10)"),
        ltv: z.number().min(0.1).max(0.95).describe("Loan-to-value ratio to use (e.g. 0.8 for 80%)"),
        supplyApy: z.number().describe("Current supply APY in percent (e.g. 3.5)"),
        borrowApy: z.number().describe("Current borrow APY in percent (e.g. 2.1)"),
        assetPriceUsd: z.number().positive().optional().describe("Current price of supply asset in USD"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const {
          chainId,
          supplyAsset,
          borrowAsset,
          initialAmount,
          loops,
          ltv,
          supplyApy,
          borrowApy,
          assetPriceUsd,
        } = input as {
          chainId: string;
          supplyAsset: string;
          borrowAsset: string;
          initialAmount: string;
          loops: number;
          ltv: number;
          supplyApy: number;
          borrowApy: number;
          assetPriceUsd?: number;
        };

        if (!AAVE_V3_POOL[chainId]) {
          return errorResult(`Aave V3 not available on "${chainId}"`);
        }

        const initial = parseFloat(initialAmount);
        let totalSupplied = initial;
        let totalBorrowed = 0;
        const steps: any[] = [];

        for (let i = 0; i < loops; i++) {
          const canBorrow = totalSupplied * ltv - totalBorrowed;
          if (canBorrow <= 0) break;

          totalBorrowed += canBorrow;
          totalSupplied += canBorrow; // Supply the borrowed amount

          const healthFactor =
            totalBorrowed > 0
              ? (totalSupplied * ltv) / totalBorrowed
              : Infinity;

          steps.push({
            loop: i + 1,
            supplied: totalSupplied.toFixed(6),
            borrowed: totalBorrowed.toFixed(6),
            healthFactor: healthFactor.toFixed(4),
          });
        }

        const leverage = totalSupplied / initial;
        const netApy = supplyApy * leverage - borrowApy * (leverage - 1);
        const healthFactor =
          totalBorrowed > 0
            ? (totalSupplied * ltv) / totalBorrowed
            : Infinity;

        // Liquidation price (how much asset needs to drop)
        const liquidationDrop =
          totalBorrowed > 0
            ? (1 - totalBorrowed / (totalSupplied * ltv)) * 100
            : 100;

        return jsonResult({
          strategy: `${loops}x leverage loop`,
          chain: chainId,
          supplyAsset,
          borrowAsset,
          initial: `${initialAmount} ${supplyAsset}`,
          result: {
            totalSupplied: `${totalSupplied.toFixed(6)} ${supplyAsset}`,
            totalBorrowed: `${totalBorrowed.toFixed(6)} ${borrowAsset}`,
            effectiveLeverage: `${leverage.toFixed(2)}x`,
            netApy: `${netApy.toFixed(2)}%`,
            healthFactor: healthFactor.toFixed(4),
            liquidationPriceDrop: `${liquidationDrop.toFixed(1)}%`,
          },
          apyBreakdown: {
            supplyApy: `${supplyApy}% × ${leverage.toFixed(2)}x = ${(supplyApy * leverage).toFixed(2)}%`,
            borrowCost: `${borrowApy}% × ${(leverage - 1).toFixed(2)}x = ${(borrowApy * (leverage - 1)).toFixed(2)}%`,
            netApy: `${netApy.toFixed(2)}%`,
          },
          usdValues: assetPriceUsd
            ? {
                initialUsd: `$${(initial * assetPriceUsd).toFixed(2)}`,
                totalExposure: `$${(totalSupplied * assetPriceUsd).toFixed(2)}`,
                totalDebt: `$${(totalBorrowed * assetPriceUsd).toFixed(2)}`,
                yearlyYield: `$${(initial * assetPriceUsd * netApy / 100).toFixed(2)}`,
              }
            : undefined,
          steps,
          risks: [
            `Liquidation if ${supplyAsset} drops ${liquidationDrop.toFixed(1)}%`,
            `Borrow rate increases reduce or eliminate yield`,
            `Smart contract risk from multiple interactions`,
            healthFactor < 1.5
              ? "WARNING: Health factor is dangerously low"
              : undefined,
          ].filter(Boolean),
        });
      },
    };
  }

  private leverageLoopBuildTool(): ToolDefinition {
    return {
      name: "defi_leverage_loop_tx",
      description: `Build the sequence of unsigned transactions for one leverage loop iteration on Aave V3: supply → borrow. Execute this multiple times for multi-loop leverage. Each iteration requires signing two transactions. Supported chains: ${SUPPORTED.join(", ")}.`,
      inputSchema: z.object({
        chainId: ChainIdSchema,
        supplyAssetAddress: AddressSchema.describe("Token address to supply"),
        borrowAssetAddress: AddressSchema.describe("Token address to borrow"),
        supplyAmount: AmountSchema.describe("Amount to supply in this loop"),
        borrowAmount: AmountSchema.describe("Amount to borrow in this loop"),
        supplyDecimals: z.number().int().min(0).max(18).describe("Decimals of supply token"),
        borrowDecimals: z.number().int().min(0).max(18).describe("Decimals of borrow token"),
        userAddress: AddressSchema.describe("Your wallet address"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const {
          chainId,
          supplyAssetAddress,
          borrowAssetAddress,
          supplyAmount,
          borrowAmount,
          supplyDecimals,
          borrowDecimals,
          userAddress,
        } = input as {
          chainId: string;
          supplyAssetAddress: string;
          borrowAssetAddress: string;
          supplyAmount: string;
          borrowAmount: string;
          supplyDecimals: number;
          borrowDecimals: number;
          userAddress: string;
        };

        const pool = AAVE_V3_POOL[chainId];
        if (!pool) {
          return errorResult(`Aave V3 not available on "${chainId}"`);
        }

        const user = getAddress(userAddress);
        const supplyRaw = BigInt(parseTokenAmount(supplyAmount, supplyDecimals));
        const borrowRaw = BigInt(parseTokenAmount(borrowAmount, borrowDecimals));

        const supplyData = encodeFunctionData({
          abi: POOL_ABI,
          functionName: "supply",
          args: [getAddress(supplyAssetAddress), supplyRaw, user, 0],
        });

        const borrowData = encodeFunctionData({
          abi: POOL_ABI,
          functionName: "borrow",
          args: [getAddress(borrowAssetAddress), borrowRaw, 2n, 0, user],
        });

        return jsonResult({
          chain: chainId,
          steps: [
            {
              step: 1,
              action: "approve",
              note: `First approve ${supplyAssetAddress} for the Aave Pool (${pool}). Use defi_token_approve.`,
            },
            {
              step: 2,
              action: "supply",
              tx: {
                chainId,
                ecosystem: "evm",
                raw: {
                  to: pool,
                  data: supplyData,
                  value: "0x0",
                  from: user,
                },
                description: `Supply ${supplyAmount} tokens to Aave V3`,
              },
            },
            {
              step: 3,
              action: "borrow",
              tx: {
                chainId,
                ecosystem: "evm",
                raw: {
                  to: pool,
                  data: borrowData,
                  value: "0x0",
                  from: user,
                },
                description: `Borrow ${borrowAmount} tokens from Aave V3 (variable rate)`,
              },
            },
          ],
          note: "Execute steps in order. After borrowing, you can supply the borrowed tokens to loop again. Use defi_simulate_bundle to verify the sequence before signing.",
        });
      },
    };
  }

  private positionSizeTool(): ToolDefinition {
    return {
      name: "defi_position_size",
      description:
        "Calculate optimal position size based on portfolio value, risk tolerance, and Kelly criterion. Helps determine how much to allocate to a trade or yield position.",
      inputSchema: z.object({
        portfolioValueUsd: z.number().positive().describe("Total portfolio value in USD"),
        maxRiskPercent: z.number().min(1).max(100).describe("Maximum portfolio % willing to risk (e.g. 5 for 5%)"),
        winProbability: z.number().min(0.01).max(0.99).optional().describe("Estimated probability of winning (0-1, e.g. 0.6 for 60%)"),
        winLossRatio: z.number().positive().optional().describe("Expected win/loss ratio (e.g. 2.0 means you win 2x what you risk)"),
        stopLossPercent: z.number().min(1).max(100).optional().describe("Stop loss percentage (e.g. 10 for -10%)"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const {
          portfolioValueUsd,
          maxRiskPercent,
          winProbability = 0.5,
          winLossRatio = 2.0,
          stopLossPercent = 10,
        } = input as {
          portfolioValueUsd: number;
          maxRiskPercent: number;
          winProbability?: number;
          winLossRatio?: number;
          stopLossPercent?: number;
        };

        // Kelly criterion: f* = (bp - q) / b
        // where b = win/loss ratio, p = win probability, q = 1-p
        const kelly =
          (winLossRatio * winProbability - (1 - winProbability)) /
          winLossRatio;
        const kellyPercent = Math.max(0, kelly * 100);

        // Conservative Kelly (half Kelly)
        const halfKelly = kellyPercent / 2;

        // Risk-based position size
        const maxRiskUsd = portfolioValueUsd * (maxRiskPercent / 100);
        const positionFromRisk = maxRiskUsd / (stopLossPercent / 100);

        // Final recommendation: minimum of risk-based and Kelly
        const recommended = Math.min(
          positionFromRisk,
          portfolioValueUsd * (halfKelly / 100)
        );

        return jsonResult({
          portfolio: `$${portfolioValueUsd.toFixed(2)}`,
          riskParameters: {
            maxRisk: `${maxRiskPercent}% ($${maxRiskUsd.toFixed(2)})`,
            winProbability: `${(winProbability * 100).toFixed(0)}%`,
            winLossRatio: `${winLossRatio}:1`,
            stopLoss: `${stopLossPercent}%`,
          },
          sizing: {
            kellyOptimal: `${kellyPercent.toFixed(1)}% ($${(portfolioValueUsd * kellyPercent / 100).toFixed(2)})`,
            halfKelly: `${halfKelly.toFixed(1)}% ($${(portfolioValueUsd * halfKelly / 100).toFixed(2)})`,
            riskBased: `$${positionFromRisk.toFixed(2)} (${(positionFromRisk / portfolioValueUsd * 100).toFixed(1)}%)`,
            recommended: `$${recommended.toFixed(2)} (${(recommended / portfolioValueUsd * 100).toFixed(1)}%)`,
          },
          atRisk: `$${(recommended * stopLossPercent / 100).toFixed(2)} (${maxRiskPercent}% of portfolio)`,
          note: kelly <= 0
            ? "Kelly criterion is negative — this trade has negative expected value. Consider passing."
            : "Half Kelly is recommended over full Kelly for better risk management.",
        });
      },
    };
  }
}
