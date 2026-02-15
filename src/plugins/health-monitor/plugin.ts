import { z } from "zod";
import { createPublicClient, http, getAddress, formatUnits } from "viem";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";
import { ChainIdSchema, AddressSchema } from "../../tools/schemas.js";

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

// Compound V3 Comet addresses
const COMPOUND_V3: Record<string, { comet: string; baseToken: string }> = {
  ethereum: { comet: "0xc3d688B66703497DAA19211EEdff47f25384cdc3", baseToken: "USDC" },
  base: { comet: "0xb125E6687d4313864e53df431d5425969c15Eb2F", baseToken: "USDC" },
  arbitrum: { comet: "0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA", baseToken: "USDC" },
  polygon: { comet: "0xF25212E676D1F7F89Cd72fFEe66158f541246445", baseToken: "USDC" },
};

const AAVE_ACCOUNT_ABI = [{
  name: "getUserAccountData",
  type: "function" as const,
  stateMutability: "view" as const,
  inputs: [{ name: "user", type: "address" }],
  outputs: [
    { name: "totalCollateralBase", type: "uint256" },
    { name: "totalDebtBase", type: "uint256" },
    { name: "availableBorrowsBase", type: "uint256" },
    { name: "currentLiquidationThreshold", type: "uint256" },
    { name: "ltv", type: "uint256" },
    { name: "healthFactor", type: "uint256" },
  ],
}] as const;

const COMET_ABI = [
  { name: "balanceOf", type: "function" as const, stateMutability: "view" as const, inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "borrowBalanceOf", type: "function" as const, stateMutability: "view" as const, inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

export class HealthMonitorPlugin implements DefiPlugin {
  readonly name = "health-monitor";
  readonly description = "Lending position health monitoring across Aave V3 and Compound V3";
  readonly version = "1.0.0";

  async initialize(_ctx: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [this.healthDashboardTool(), this.stablecoinMonitorTool()];
  }

  private healthDashboardTool(): ToolDefinition {
    return {
      name: "defi_health_dashboard",
      description:
        "Check all lending positions across Aave V3 and Compound V3 on all chains simultaneously. Returns health factors, collateral, debt, and liquidation risk for every active position. Run this regularly for users with lending positions.",
      inputSchema: z.object({
        userAddress: AddressSchema.describe("Wallet address to monitor"),
        chainIds: z
          .array(z.string())
          .optional()
          .describe("Chains to check (default: all supported)"),
      }),
      handler: async (
        input: unknown,
        context: PluginContext
      ): Promise<ToolResult> => {
        try {
          const { userAddress, chainIds } = input as {
            userAddress: string;
            chainIds?: string[];
          };

          const user = getAddress(userAddress);
          const positions: any[] = [];
          let overallRisk = "SAFE";

          // Check Aave V3 on all chains
          const aaveChains = chainIds || Object.keys(AAVE_V3_POOL);
          const aaveResults = await Promise.allSettled(
            aaveChains
              .filter((c) => AAVE_V3_POOL[c])
              .map(async (chainId) => {
                const adapter = context.getChainAdapterForChain(chainId);
                const chain = adapter.getChain(chainId);
                if (!chain) return null;

                const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
                const client = createPublicClient({ transport: http(rpcUrl) });

                const result = await client.readContract({
                  address: getAddress(AAVE_V3_POOL[chainId]) as `0x${string}`,
                  abi: AAVE_ACCOUNT_ABI,
                  functionName: "getUserAccountData",
                  args: [user],
                });

                const [totalCollateral, totalDebt, availableBorrows, , , healthFactor] = result;
                const collateralUsd = Number(totalCollateral) / 1e8;
                const debtUsd = Number(totalDebt) / 1e8;

                if (debtUsd === 0 && collateralUsd === 0) return null;

                const hf = debtUsd > 0 ? Number(healthFactor) / 1e18 : Infinity;
                let risk: string;
                if (debtUsd === 0) risk = "none";
                else if (hf > 2) risk = "safe";
                else if (hf > 1.5) risk = "moderate";
                else if (hf > 1.1) risk = "AT RISK";
                else risk = "CRITICAL";

                return {
                  protocol: "Aave V3",
                  chain: chain.name,
                  chainId,
                  collateral: `$${collateralUsd.toFixed(2)}`,
                  debt: `$${debtUsd.toFixed(2)}`,
                  healthFactor: debtUsd === 0 ? "∞" : hf.toFixed(4),
                  risk,
                };
              })
          );

          for (const r of aaveResults) {
            if (r.status === "fulfilled" && r.value) {
              positions.push(r.value);
              if (r.value.risk === "CRITICAL") overallRisk = "CRITICAL";
              else if (r.value.risk === "AT RISK" && overallRisk !== "CRITICAL")
                overallRisk = "AT RISK";
              else if (
                r.value.risk === "moderate" &&
                overallRisk === "SAFE"
              )
                overallRisk = "MODERATE";
            }
          }

          // Check Compound V3 on all chains
          const compChains = chainIds || Object.keys(COMPOUND_V3);
          const compResults = await Promise.allSettled(
            compChains
              .filter((c) => COMPOUND_V3[c])
              .map(async (chainId) => {
                const market = COMPOUND_V3[chainId];
                const adapter = context.getChainAdapterForChain(chainId);
                const chain = adapter.getChain(chainId);
                if (!chain) return null;

                const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
                const client = createPublicClient({ transport: http(rpcUrl) });

                const [supplyBal, borrowBal] = await Promise.all([
                  client.readContract({
                    address: getAddress(market.comet) as `0x${string}`,
                    abi: COMET_ABI,
                    functionName: "balanceOf",
                    args: [user],
                  }),
                  client.readContract({
                    address: getAddress(market.comet) as `0x${string}`,
                    abi: COMET_ABI,
                    functionName: "borrowBalanceOf",
                    args: [user],
                  }),
                ]);

                if (supplyBal === 0n && borrowBal === 0n) return null;

                const supply = Number(formatUnits(supplyBal, 6));
                const borrow = Number(formatUnits(borrowBal, 6));

                return {
                  protocol: "Compound V3",
                  chain: chain.name,
                  chainId,
                  supplied: `${supply.toFixed(2)} ${market.baseToken}`,
                  borrowed: `${borrow.toFixed(2)} ${market.baseToken}`,
                  risk: borrow > 0 ? "monitor" : "none",
                };
              })
          );

          for (const r of compResults) {
            if (r.status === "fulfilled" && r.value) {
              positions.push(r.value);
            }
          }

          return jsonResult({
            wallet: userAddress,
            overallRisk,
            positionCount: positions.length,
            positions,
            alerts:
              overallRisk === "CRITICAL"
                ? [
                    "ONE OR MORE POSITIONS AT CRITICAL RISK OF LIQUIDATION",
                    "Recommend immediate action: repay debt or add collateral",
                  ]
                : overallRisk === "AT RISK"
                  ? [
                      "Position health factors are low. Monitor closely.",
                      "Consider adding collateral or partially repaying debt.",
                    ]
                  : positions.length === 0
                    ? ["No active lending positions found"]
                    : ["All positions are healthy"],
          });
        } catch (e: any) {
          return errorResult(`Health dashboard failed: ${e.message}`);
        }
      },
    };
  }

  private stablecoinMonitorTool(): ToolDefinition {
    return {
      name: "defi_stablecoin_monitor",
      description:
        "Monitor stablecoin peg health for major stablecoins (USDT, USDC, DAI, FRAX, etc.). Reports current price deviation from $1 peg, market cap changes, and depegging alerts.",
      inputSchema: z.object({}),
      handler: async (): Promise<ToolResult> => {
        try {
          const res = await fetch(
            "https://stablecoins.llama.fi/stablecoins?includePrices=true"
          );
          if (!res.ok) throw new Error(`DefiLlama stablecoins ${res.status}`);
          const data = await res.json();

          const stablecoins = (data.peggedAssets || [])
            .slice(0, 15)
            .map((s: any) => {
              const price = s.price;
              const deviation = price ? Math.abs(price - 1) * 100 : null;
              const mcap = s.circulating?.peggedUSD || 0;

              let pegStatus: string;
              if (!price) pegStatus = "unknown";
              else if (deviation! < 0.1) pegStatus = "STABLE";
              else if (deviation! < 0.5) pegStatus = "minor deviation";
              else if (deviation! < 2) pegStatus = "WARNING — notable depeg";
              else pegStatus = "ALERT — significant depeg";

              return {
                name: s.name,
                symbol: s.symbol,
                price: price ? `$${price.toFixed(4)}` : "unknown",
                pegDeviation: deviation !== null ? `${deviation.toFixed(3)}%` : "unknown",
                pegStatus,
                marketCap: `$${(mcap / 1e9).toFixed(2)}B`,
                type: s.pegType || "fiat-backed",
              };
            });

          const depegged = stablecoins.filter(
            (s: any) =>
              s.pegStatus.includes("WARNING") || s.pegStatus.includes("ALERT")
          );

          return jsonResult({
            timestamp: new Date().toISOString(),
            stablecoinCount: stablecoins.length,
            depegAlerts: depegged.length,
            stablecoins,
            alerts:
              depegged.length > 0
                ? depegged.map(
                    (s: any) =>
                      `${s.symbol}: ${s.pegStatus} (${s.price}, ${s.pegDeviation} off peg)`
                  )
                : ["All major stablecoins are holding their peg"],
          });
        } catch (e: any) {
          return errorResult(`Stablecoin monitor failed: ${e.message}`);
        }
      },
    };
  }
}
