import { createPublicClient, http, formatUnits } from "viem";
import type { YieldSource, YieldOpportunity } from "../../../core/yield-types.js";
import type { PluginContext } from "../../../core/types.js";
import {
  COMPOUND_V3_MARKETS,
  getSupportedCompoundV3Chains,
} from "../../compound-v3/addresses.js";
import { COMET_ABI, rateToApr } from "../../compound-v3/abi.js";

export class CompoundV3YieldSource implements YieldSource {
  readonly protocolName = "Compound V3";
  readonly supportedChains = getSupportedCompoundV3Chains();

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
    const market = COMPOUND_V3_MARKETS[chainId];
    if (!market) return null;

    if (tokenSymbol.toUpperCase() !== market.baseToken.toUpperCase())
      return null;

    const chain = context.getChainAdapterForChain(chainId).getChain(chainId);
    if (!chain) return null;

    const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
    const client = createPublicClient({
      transport: http(rpcUrl, { batch: true }),
      batch: { multicall: true },
    });

    const [utilization, totalSupply, totalBorrow] = await Promise.all([
      client.readContract({
        address: market.comet,
        abi: COMET_ABI,
        functionName: "getUtilization",
      }),
      client.readContract({
        address: market.comet,
        abi: COMET_ABI,
        functionName: "totalSupply",
      }),
      client.readContract({
        address: market.comet,
        abi: COMET_ABI,
        functionName: "totalBorrow",
      }),
    ]);

    const [supplyRate, borrowRate] = await Promise.all([
      client.readContract({
        address: market.comet,
        abi: COMET_ABI,
        functionName: "getSupplyRate",
        args: [utilization],
      }),
      client.readContract({
        address: market.comet,
        abi: COMET_ABI,
        functionName: "getBorrowRate",
        args: [utilization],
      }),
    ]);

    const supplyApr = rateToApr(supplyRate);
    const borrowApr = rateToApr(borrowRate);

    const isStable =
      market.baseToken === "USDC" || market.baseToken === "USDT";
    const priceUsd = isStable ? 1 : 0;
    const tvl =
      Number(formatUnits(totalSupply, market.baseTokenDecimals)) * priceUsd;
    const utilizationPct = (Number(utilization) / 1e18) * 100;

    return {
      protocol: "Compound V3",
      chainId,
      chainName: chain.name,
      asset: market.baseToken,
      assetAddress: market.comet,
      apy: supplyApr,
      apyType: "variable",
      tvl,
      riskLevel: "low",
      category: "lending",
      metadata: {
        borrowApy: borrowApr,
        utilization: utilizationPct,
      },
    };
  }
}
