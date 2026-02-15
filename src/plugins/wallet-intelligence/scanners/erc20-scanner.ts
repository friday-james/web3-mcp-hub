import {
  createPublicClient,
  http,
  getAddress,
  erc20Abi,
  formatUnits,
} from "viem";
import type { ProtocolScanner, ProtocolPosition, PositionAsset } from "../../../core/scanner-types.js";
import type { PluginContext } from "../../../core/types.js";
import { KNOWN_TOKENS } from "../../../chains/evm/known-tokens.js";
import { CoinGeckoClient } from "../../token-info/coingecko.js";

export class Erc20Scanner implements ProtocolScanner {
  readonly protocolName = "ERC20 Tokens";
  readonly supportedChains = Object.keys(KNOWN_TOKENS);

  async scanPositions(
    chainId: string,
    walletAddress: string,
    context: PluginContext
  ): Promise<ProtocolPosition[]> {
    const tokens = KNOWN_TOKENS[chainId];
    if (!tokens) return [];

    const chain = context.getChainAdapterForChain(chainId).getChain(chainId);
    if (!chain) return [];

    const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
    const client = createPublicClient({ transport: http(rpcUrl) });
    const user = getAddress(walletAddress);
    const tokenEntries = Object.values(tokens);

    // Multicall balanceOf for all known tokens
    const results = await client.multicall({
      contracts: tokenEntries.map((t) => ({
        address: getAddress(t.address) as `0x${string}`,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [user],
      })),
    });

    // Filter to non-zero balances
    const nonZero: Array<{ token: typeof tokenEntries[0]; balance: bigint }> = [];
    for (let i = 0; i < tokenEntries.length; i++) {
      const balance = results[i].result as bigint | undefined;
      if (balance && balance > 0n) {
        nonZero.push({ token: tokenEntries[i], balance });
      }
    }

    if (nonZero.length === 0) return [];

    // Get USD prices
    const coingeckoIds = [
      ...new Set(nonZero.map((n) => n.token.coingeckoId).filter(Boolean)),
    ] as string[];
    let priceMap: Record<string, number> = {};
    if (coingeckoIds.length > 0) {
      try {
        const cg = new CoinGeckoClient(context.config.apiKeys.coingecko);
        const prices = await cg.getPricesByIds(coingeckoIds);
        for (const [id, data] of Object.entries(prices)) {
          priceMap[id] = data.usd;
        }
      } catch {
        // continue without prices
      }
    }

    const assets: PositionAsset[] = [];
    let totalUsd = 0;

    for (const { token, balance } of nonZero) {
      const formatted = formatUnits(balance, token.decimals);
      const balNum = parseFloat(formatted);
      const price = token.coingeckoId ? priceMap[token.coingeckoId] ?? 0 : 0;
      const usd = balNum * price;
      totalUsd += usd;

      assets.push({
        symbol: token.symbol,
        address: token.address,
        balance: balNum.toFixed(6),
        balanceUsd: usd,
      });
    }

    return [
      {
        protocol: "ERC20 Tokens",
        type: "erc20",
        chainId,
        chainName: chain.name,
        assets,
        totalValueUsd: totalUsd,
      },
    ];
  }
}
