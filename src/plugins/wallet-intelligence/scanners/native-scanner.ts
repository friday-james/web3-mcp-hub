import type { ProtocolScanner, ProtocolPosition } from "../../../core/scanner-types.js";
import type { PluginContext } from "../../../core/types.js";
import { CoinGeckoClient } from "../../token-info/coingecko.js";

export class NativeBalanceScanner implements ProtocolScanner {
  readonly protocolName = "Native Tokens";
  readonly supportedChains: string[] = []; // determined at runtime

  async scanPositions(
    chainId: string,
    walletAddress: string,
    context: PluginContext
  ): Promise<ProtocolPosition[]> {
    const adapter = context.getChainAdapterForChain(chainId);
    const chain = adapter.getChain(chainId);
    if (!chain) return [];
    if (!adapter.isValidAddress(chainId, walletAddress)) return [];

    const balance = await adapter.getNativeBalance(chainId, walletAddress);
    const balanceNum = parseFloat(balance.balanceFormatted);
    if (balanceNum === 0) return [];

    // Get USD price
    let priceUsd = 0;
    if (chain.nativeToken.coingeckoId) {
      try {
        const cg = new CoinGeckoClient(context.config.apiKeys.coingecko);
        const prices = await cg.getPricesByIds([chain.nativeToken.coingeckoId]);
        priceUsd = prices[chain.nativeToken.coingeckoId]?.usd ?? 0;
      } catch {
        // continue without price
      }
    }

    const valueUsd = balanceNum * priceUsd;

    return [
      {
        protocol: "Native Tokens",
        type: "native",
        chainId,
        chainName: chain.name,
        assets: [
          {
            symbol: chain.nativeToken.symbol,
            address: chain.nativeToken.address,
            balance: balance.balanceFormatted,
            balanceUsd: valueUsd,
          },
        ],
        totalValueUsd: valueUsd,
      },
    ];
  }
}
