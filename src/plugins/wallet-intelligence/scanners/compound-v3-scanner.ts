import { createPublicClient, http, getAddress, formatUnits } from "viem";
import type {
  ProtocolScanner,
  ProtocolPosition,
} from "../../../core/scanner-types.js";
import type { PluginContext } from "../../../core/types.js";
import {
  COMPOUND_V3_MARKETS,
  getSupportedCompoundV3Chains,
} from "../../compound-v3/addresses.js";
import { COMET_ABI, rateToApr } from "../../compound-v3/abi.js";

export class CompoundV3Scanner implements ProtocolScanner {
  readonly protocolName = "Compound V3";
  readonly supportedChains = getSupportedCompoundV3Chains();

  async scanPositions(
    chainId: string,
    walletAddress: string,
    context: PluginContext
  ): Promise<ProtocolPosition[]> {
    const market = COMPOUND_V3_MARKETS[chainId];
    if (!market) return [];

    const chain = context.getChainAdapterForChain(chainId).getChain(chainId);
    if (!chain) return [];

    const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
    const client = createPublicClient({
      transport: http(rpcUrl, { batch: true }),
      batch: { multicall: true },
    });
    const user = getAddress(walletAddress);

    try {
      const [supplyBal, borrowBal, utilization] = await Promise.all([
        client.readContract({
          address: market.comet,
          abi: COMET_ABI,
          functionName: "balanceOf",
          args: [user],
        }),
        client.readContract({
          address: market.comet,
          abi: COMET_ABI,
          functionName: "borrowBalanceOf",
          args: [user],
        }),
        client.readContract({
          address: market.comet,
          abi: COMET_ABI,
          functionName: "getUtilization",
        }),
      ]);

      if (supplyBal === 0n && borrowBal === 0n) return [];

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

      // For USDC, 1 token = $1
      const isStable =
        market.baseToken === "USDC" || market.baseToken === "USDT";
      const priceUsd = isStable ? 1 : 0;

      const positions: ProtocolPosition[] = [];

      if (supplyBal > 0n) {
        const balance = Number(
          formatUnits(supplyBal, market.baseTokenDecimals)
        );
        positions.push({
          protocol: "Compound V3",
          type: "lending-supply",
          chainId,
          chainName: chain.name,
          assets: [
            {
              symbol: market.baseToken,
              address: market.comet,
              balance: balance.toFixed(6),
              balanceUsd: balance * priceUsd,
              apy: supplyApr,
            },
          ],
          totalValueUsd: balance * priceUsd,
        });
      }

      if (borrowBal > 0n) {
        const balance = Number(
          formatUnits(borrowBal, market.baseTokenDecimals)
        );
        positions.push({
          protocol: "Compound V3",
          type: "lending-borrow",
          chainId,
          chainName: chain.name,
          assets: [
            {
              symbol: market.baseToken,
              address: market.comet,
              balance: balance.toFixed(6),
              balanceUsd: balance * priceUsd,
              apy: borrowApr,
              isDebt: true,
            },
          ],
          totalValueUsd: -(balance * priceUsd),
        });
      }

      return positions;
    } catch {
      return [];
    }
  }
}
