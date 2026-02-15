import { z } from "zod";
import { createPublicClient, http, getAddress, formatUnits } from "viem";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";
import { ChainIdSchema, AddressSchema } from "../../tools/schemas.js";

// Aave V3 Pool addresses
const AAVE_V3_POOL: Record<string, string> = {
  ethereum: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
  arbitrum: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  optimism: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  polygon: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  base: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
  avalanche: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
};

const AAVE_UI_DATA_PROVIDER: Record<string, string> = {
  ethereum: "0x91c0eA31b49B69Ea18607702c5d9aC360bf3dE7d",
  arbitrum: "0x145dE30c929a065582da84Cf96F88460dB9745A7",
  optimism: "0x64f558d4BFC1c03b8B4B2cF80a2E0C5E3e8dCf68",
  polygon: "0xC69728f11E9E6127733751c8410432913123acf1",
  base: "0x174446a6741300cD2E7C1b1A636Fee99c8F83502",
  avalanche: "0xdBbFaFc45B7E4B5CD4400eda0f6F6B70fEE8e3A8",
};

const SUPPORTED = Object.keys(AAVE_V3_POOL);

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function errorResult(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }], isError: true };
}

export class AaveExtendedPlugin implements DefiPlugin {
  readonly name = "aave-extended";
  readonly description = "Aave V3 extended: flash loan info, reserve data, and health factor simulation";
  readonly version = "1.0.0";

  async initialize(_ctx: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [
      this.flashLoanInfoTool(),
      this.reserveDataTool(),
      this.healthFactorTool(),
    ];
  }

  private flashLoanInfoTool(): ToolDefinition {
    return {
      name: "defi_aave_flash_loan_info",
      description: `Get Aave V3 flash loan information: available liquidity per asset, premium rates, and whether flash loans are enabled. Supported chains: ${SUPPORTED.join(", ")}.`,
      inputSchema: z.object({
        chainId: ChainIdSchema,
      }),
      handler: async (input: unknown, context: PluginContext): Promise<ToolResult> => {
        try {
          const { chainId } = input as { chainId: string };
          if (!AAVE_V3_POOL[chainId]) return errorResult(`Aave V3 not available on "${chainId}". Supported: ${SUPPORTED.join(", ")}`);

          // Use Aave subgraph for reserve data
          const res = await fetch("https://api.thegraph.com/subgraphs/name/aave/protocol-v3", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: `{
                reserves(first: 30, orderBy: totalLiquidity, orderDirection: desc) {
                  symbol
                  underlyingAsset
                  totalLiquidity
                  availableLiquidity
                  flashLoanEnabled
                  decimals
                  liquidityRate
                  variableBorrowRate
                }
              }`,
            }),
          });

          if (!res.ok) throw new Error(`Aave subgraph ${res.status}`);
          const data = await res.json();

          const reserves = (data.data?.reserves || [])
            .filter((r: any) => r.flashLoanEnabled)
            .map((r: any) => ({
              symbol: r.symbol,
              address: r.underlyingAsset,
              availableLiquidity: `${Number(formatUnits(BigInt(r.availableLiquidity), r.decimals)).toFixed(2)} ${r.symbol}`,
              flashLoanEnabled: r.flashLoanEnabled,
              flashLoanPremium: "0.05%",
              supplyApy: `${(Number(r.liquidityRate) / 1e25).toFixed(2)}%`,
              borrowApy: `${(Number(r.variableBorrowRate) / 1e25).toFixed(2)}%`,
            }));

          return jsonResult({
            chain: chainId,
            protocol: "Aave V3",
            flashLoanPremium: "0.05% (5 bps)",
            flashLoanPremiumTotal: "0.09% if not repaid in same tx",
            availableAssets: reserves.length,
            reserves,
          });
        } catch (e: any) {
          return errorResult(`Failed to fetch flash loan info: ${e.message}`);
        }
      },
    };
  }

  private reserveDataTool(): ToolDefinition {
    return {
      name: "defi_aave_reserves",
      description: `Get detailed Aave V3 reserve data for all assets: supply/borrow APY, utilization, caps, and risk parameters. Supported chains: ${SUPPORTED.join(", ")}.`,
      inputSchema: z.object({
        chainId: ChainIdSchema,
        limit: z.number().int().min(1).max(50).optional().describe("Number of reserves (default 20)"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { chainId, limit = 20 } = input as { chainId: string; limit?: number };
          if (!AAVE_V3_POOL[chainId]) return errorResult(`Aave V3 not available on "${chainId}"`);

          const res = await fetch("https://api.thegraph.com/subgraphs/name/aave/protocol-v3", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: `{
                reserves(first: ${limit}, orderBy: totalLiquidity, orderDirection: desc) {
                  symbol
                  name
                  underlyingAsset
                  decimals
                  totalLiquidity
                  availableLiquidity
                  totalCurrentVariableDebt
                  liquidityRate
                  variableBorrowRate
                  usageAsCollateralEnabled
                  borrowingEnabled
                  isActive
                  isFrozen
                  baseLTVasCollateral
                  reserveLiquidationThreshold
                  reserveLiquidationBonus
                }
              }`,
            }),
          });

          if (!res.ok) throw new Error(`Aave subgraph ${res.status}`);
          const data = await res.json();

          const reserves = (data.data?.reserves || []).map((r: any) => {
            const totalLiq = Number(formatUnits(BigInt(r.totalLiquidity), r.decimals));
            const availLiq = Number(formatUnits(BigInt(r.availableLiquidity), r.decimals));
            const totalBorrow = Number(formatUnits(BigInt(r.totalCurrentVariableDebt), r.decimals));
            const utilization = totalLiq > 0 ? ((totalLiq - availLiq) / totalLiq * 100) : 0;

            return {
              symbol: r.symbol,
              name: r.name,
              address: r.underlyingAsset,
              supplyApy: `${(Number(r.liquidityRate) / 1e25).toFixed(2)}%`,
              borrowApy: `${(Number(r.variableBorrowRate) / 1e25).toFixed(2)}%`,
              totalSupply: `${totalLiq.toFixed(0)} ${r.symbol}`,
              totalBorrowed: `${totalBorrow.toFixed(0)} ${r.symbol}`,
              utilization: `${utilization.toFixed(1)}%`,
              collateralEnabled: r.usageAsCollateralEnabled,
              borrowEnabled: r.borrowingEnabled,
              ltv: `${Number(r.baseLTVasCollateral) / 100}%`,
              liquidationThreshold: `${Number(r.reserveLiquidationThreshold) / 100}%`,
              liquidationBonus: `${Number(r.reserveLiquidationBonus) / 100 - 100}%`,
              status: r.isFrozen ? "frozen" : r.isActive ? "active" : "inactive",
            };
          });

          return jsonResult({ chain: chainId, protocol: "Aave V3", reserveCount: reserves.length, reserves });
        } catch (e: any) {
          return errorResult(`Failed to fetch reserve data: ${e.message}`);
        }
      },
    };
  }

  private healthFactorTool(): ToolDefinition {
    return {
      name: "defi_aave_health_factor",
      description: `Check a user's Aave V3 health factor and liquidation risk. Health factor below 1.0 means the position can be liquidated. Supported chains: ${SUPPORTED.join(", ")}.`,
      inputSchema: z.object({
        chainId: ChainIdSchema,
        userAddress: AddressSchema.describe("Wallet address to check"),
      }),
      handler: async (input: unknown, context: PluginContext): Promise<ToolResult> => {
        try {
          const { chainId, userAddress } = input as { chainId: string; userAddress: string };
          const poolAddr = AAVE_V3_POOL[chainId];
          if (!poolAddr) return errorResult(`Aave V3 not available on "${chainId}"`);

          const adapter = context.getChainAdapterForChain(chainId);
          const chain = adapter.getChain(chainId);
          if (!chain) return errorResult(`Chain "${chainId}" not found`);

          const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
          const client = createPublicClient({ transport: http(rpcUrl) });

          const getUserAccountDataAbi = [{
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

          const result = await client.readContract({
            address: getAddress(poolAddr) as `0x${string}`,
            abi: getUserAccountDataAbi,
            functionName: "getUserAccountData",
            args: [getAddress(userAddress)],
          });

          const [totalCollateral, totalDebt, availableBorrows, liqThreshold, ltv, healthFactor] = result;

          // Values are in base currency units (USD with 8 decimals)
          const collateralUsd = Number(totalCollateral) / 1e8;
          const debtUsd = Number(totalDebt) / 1e8;
          const borrowableUsd = Number(availableBorrows) / 1e8;
          const hf = Number(healthFactor) / 1e18;

          let riskLevel: string;
          if (debtUsd === 0) riskLevel = "no debt";
          else if (hf > 2) riskLevel = "safe";
          else if (hf > 1.5) riskLevel = "moderate";
          else if (hf > 1.1) riskLevel = "at risk";
          else riskLevel = "DANGER - near liquidation";

          return jsonResult({
            chain: chainId,
            protocol: "Aave V3",
            user: userAddress,
            healthFactor: debtUsd === 0 ? "∞ (no debt)" : hf.toFixed(4),
            riskLevel,
            totalCollateral: `$${collateralUsd.toFixed(2)}`,
            totalDebt: `$${debtUsd.toFixed(2)}`,
            availableBorrows: `$${borrowableUsd.toFixed(2)}`,
            ltv: `${Number(ltv) / 100}%`,
            liquidationThreshold: `${Number(liqThreshold) / 100}%`,
            note: hf < 1.1 && debtUsd > 0
              ? "WARNING: Position is at high risk of liquidation. Consider repaying debt or adding collateral."
              : undefined,
          });
        } catch (e: any) {
          return errorResult(`Failed to check health factor: ${e.message}`);
        }
      },
    };
  }
}
