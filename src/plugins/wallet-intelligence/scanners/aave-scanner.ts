import {
  createPublicClient,
  http,
  getAddress,
  formatUnits,
  maxUint256,
} from "viem";
import type { ProtocolScanner, ProtocolPosition, PositionAsset } from "../../../core/scanner-types.js";
import type { PluginContext } from "../../../core/types.js";
import { AAVE_V3_ADDRESSES, getSupportedLendingChains } from "../../lending/aave-addresses.js";
import { UI_POOL_DATA_PROVIDER_ABI, POOL_ABI, rayToApy } from "../../lending/aave-abi.js";

export class AaveV3Scanner implements ProtocolScanner {
  readonly protocolName = "Aave V3";
  readonly supportedChains = getSupportedLendingChains();

  async scanPositions(
    chainId: string,
    walletAddress: string,
    context: PluginContext
  ): Promise<ProtocolPosition[]> {
    const addrs = AAVE_V3_ADDRESSES[chainId];
    if (!addrs) return [];

    const chain = context.getChainAdapterForChain(chainId).getChain(chainId);
    if (!chain) return [];

    const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
    const client = createPublicClient({
      transport: http(rpcUrl, { batch: true }),
      batch: { multicall: true },
    });
    const user = getAddress(walletAddress);

    let userReservesResult: readonly [any[], any];
    let reservesResult: readonly [any[], any];
    try {
      [userReservesResult, reservesResult] = await Promise.all([
        client.readContract({
          address: addrs.uiPoolDataProvider,
          abi: UI_POOL_DATA_PROVIDER_ABI,
          functionName: "getUserReservesData",
          args: [addrs.poolAddressesProvider, user],
        }) as Promise<readonly [any[], any]>,
        client.readContract({
          address: addrs.uiPoolDataProvider,
          abi: UI_POOL_DATA_PROVIDER_ABI,
          functionName: "getReservesData",
          args: [addrs.poolAddressesProvider],
        }) as Promise<readonly [any[], any]>,
      ]);
    } catch {
      // RPC gas limit or other failure — skip this chain
      return [];
    }

    const [userReserves] = userReservesResult;
    const [reserves, baseCurrency] = reservesResult;

    const refUnit = Number(baseCurrency.marketReferenceCurrencyUnit);
    const refPriceUsd =
      Number(baseCurrency.marketReferenceCurrencyPriceInUsd) /
      10 ** baseCurrency.networkBaseTokenPriceDecimals;

    // Build reserve metadata lookup
    const reserveMap = new Map<
      string,
      {
        symbol: string;
        decimals: number;
        liquidityIndex: bigint;
        variableBorrowIndex: bigint;
        priceUsd: number;
        supplyApy: number;
        borrowApy: number;
      }
    >();
    for (const r of reserves) {
      const priceUsd =
        (Number(r.priceInMarketReferenceCurrency) / refUnit) * refPriceUsd;
      reserveMap.set(r.underlyingAsset.toLowerCase(), {
        symbol: r.symbol,
        decimals: Number(r.decimals),
        liquidityIndex: r.liquidityIndex,
        variableBorrowIndex: r.variableBorrowIndex,
        priceUsd,
        supplyApy: rayToApy(r.liquidityRate),
        borrowApy: rayToApy(r.variableBorrowRate),
      });
    }

    const positions: ProtocolPosition[] = [];
    const supplyAssets: PositionAsset[] = [];
    const borrowAssets: PositionAsset[] = [];
    let supplyTotal = 0;
    let borrowTotal = 0;

    for (const ur of userReserves) {
      const meta = reserveMap.get(ur.underlyingAsset.toLowerCase());
      if (!meta) continue;

      // Supplied
      if (ur.scaledATokenBalance > 0n) {
        const actualBalance =
          (ur.scaledATokenBalance * meta.liquidityIndex) / 10n ** 27n;
        const formatted = Number(formatUnits(actualBalance, meta.decimals));
        const usd = formatted * meta.priceUsd;
        supplyTotal += usd;
        supplyAssets.push({
          symbol: meta.symbol,
          address: ur.underlyingAsset,
          balance: formatted.toFixed(6),
          balanceUsd: usd,
          apy: meta.supplyApy,
        });
      }

      // Variable debt
      if (ur.scaledVariableDebt > 0n) {
        const actualDebt =
          (ur.scaledVariableDebt * meta.variableBorrowIndex) / 10n ** 27n;
        const formatted = Number(formatUnits(actualDebt, meta.decimals));
        const usd = formatted * meta.priceUsd;
        borrowTotal += usd;
        borrowAssets.push({
          symbol: meta.symbol,
          address: ur.underlyingAsset,
          balance: formatted.toFixed(6),
          balanceUsd: usd,
          apy: meta.borrowApy,
          isDebt: true,
        });
      }

      // Stable debt
      if (ur.principalStableDebt > 0n) {
        const formatted = Number(
          formatUnits(ur.principalStableDebt, meta.decimals)
        );
        const usd = formatted * meta.priceUsd;
        borrowTotal += usd;
        borrowAssets.push({
          symbol: meta.symbol,
          address: ur.underlyingAsset,
          balance: formatted.toFixed(6),
          balanceUsd: usd,
          isDebt: true,
        });
      }
    }

    if (supplyAssets.length > 0) {
      positions.push({
        protocol: "Aave V3",
        type: "lending-supply",
        chainId,
        chainName: chain.name,
        assets: supplyAssets,
        totalValueUsd: supplyTotal,
      });
    }

    if (borrowAssets.length > 0) {
      positions.push({
        protocol: "Aave V3",
        type: "lending-borrow",
        chainId,
        chainName: chain.name,
        assets: borrowAssets,
        totalValueUsd: -borrowTotal, // negative for debt
      });
    }

    return positions;
  }
}
