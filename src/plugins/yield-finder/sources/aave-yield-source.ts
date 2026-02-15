import { createPublicClient, http, formatUnits } from "viem";
import type { YieldSource, YieldOpportunity } from "../../../core/yield-types.js";
import type { PluginContext } from "../../../core/types.js";
import {
  AAVE_V3_ADDRESSES,
  getSupportedLendingChains,
} from "../../lending/aave-addresses.js";
import { UI_POOL_DATA_PROVIDER_ABI, rayToApy } from "../../lending/aave-abi.js";

export class AaveYieldSource implements YieldSource {
  readonly protocolName = "Aave V3";
  readonly supportedChains = getSupportedLendingChains();

  async getYieldOpportunities(
    tokenSymbol: string,
    context: PluginContext
  ): Promise<YieldOpportunity[]> {
    const results = await Promise.all(
      this.supportedChains.map((chainId) =>
        this.scanChain(chainId, tokenSymbol, context).catch(() => null)
      )
    );
    return results.filter(Boolean) as YieldOpportunity[];
  }

  private async scanChain(
    chainId: string,
    tokenSymbol: string,
    context: PluginContext
  ): Promise<YieldOpportunity | null> {
    const addrs = AAVE_V3_ADDRESSES[chainId];
    if (!addrs) return null;

    const chain = context.getChainAdapterForChain(chainId).getChain(chainId);
    if (!chain) return null;

    const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
    const client = createPublicClient({
      transport: http(rpcUrl, { batch: true }),
      batch: { multicall: true },
    });

    const [reserves, baseCurrency] = (await client.readContract({
      address: addrs.uiPoolDataProvider,
      abi: UI_POOL_DATA_PROVIDER_ABI,
      functionName: "getReservesData",
      args: [addrs.poolAddressesProvider],
    })) as readonly [any[], any];

    const refUnit = Number(baseCurrency.marketReferenceCurrencyUnit);
    const refPriceUsd =
      Number(baseCurrency.marketReferenceCurrencyPriceInUsd) /
      10 ** baseCurrency.networkBaseTokenPriceDecimals;

    // Find matching reserve
    const reserve = reserves.find(
      (r: any) =>
        r.symbol.toUpperCase() === tokenSymbol.toUpperCase() &&
        r.isActive &&
        !r.isPaused &&
        !r.isFrozen
    );

    if (!reserve) return null;

    const decimals = Number(reserve.decimals);
    const priceUsd =
      (Number(reserve.priceInMarketReferenceCurrency) / refUnit) * refPriceUsd;
    const availableLiquidity = Number(
      formatUnits(reserve.availableLiquidity, decimals)
    );
    const totalVariableDebt = Number(
      formatUnits(reserve.totalScaledVariableDebt, decimals)
    );
    const totalStableDebt = Number(
      formatUnits(reserve.totalPrincipalStableDebt, decimals)
    );
    const totalSupplied = availableLiquidity + totalVariableDebt + totalStableDebt;
    const tvl = totalSupplied * priceUsd;

    return {
      protocol: "Aave V3",
      chainId,
      chainName: chain.name,
      asset: reserve.symbol,
      assetAddress: reserve.underlyingAsset,
      apy: rayToApy(reserve.liquidityRate),
      apyType: "variable",
      tvl,
      riskLevel: "low",
      category: "lending",
      metadata: {
        borrowApy: rayToApy(reserve.variableBorrowRate),
        utilization:
          totalSupplied > 0
            ? ((totalVariableDebt + totalStableDebt) / totalSupplied) * 100
            : 0,
        ltv: Number(reserve.baseLTVasCollateral) / 100,
        liquidationThreshold:
          Number(reserve.reserveLiquidationThreshold) / 100,
      },
    };
  }
}
