import { createPublicClient, http, getAddress, formatUnits, erc20Abi } from "viem";
import type {
  ProtocolScanner,
  ProtocolPosition,
  PositionAsset,
} from "../../../core/scanner-types.js";
import type { PluginContext } from "../../../core/types.js";

const STETH_ADDRESSES: Record<string, `0x${string}`> = {
  ethereum: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",
};

const WSTETH_ADDRESSES: Record<string, `0x${string}`> = {
  ethereum: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
  arbitrum: "0x5979D7b546E38E414F7E9822514be443A4800529",
  optimism: "0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb",
  base: "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452",
  polygon: "0x03b54A6e9a984069379fae1a4fC4dBAE93B3bCCD",
};

const SUPPORTED_CHAINS = [
  ...new Set([
    ...Object.keys(STETH_ADDRESSES),
    ...Object.keys(WSTETH_ADDRESSES),
  ]),
];

export class LidoScanner implements ProtocolScanner {
  readonly protocolName = "Lido";
  readonly supportedChains = SUPPORTED_CHAINS;

  async scanPositions(
    chainId: string,
    walletAddress: string,
    context: PluginContext
  ): Promise<ProtocolPosition[]> {
    const stethAddr = STETH_ADDRESSES[chainId];
    const wstethAddr = WSTETH_ADDRESSES[chainId];
    if (!stethAddr && !wstethAddr) return [];

    const chain = context.getChainAdapterForChain(chainId).getChain(chainId);
    if (!chain) return [];

    const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
    const client = createPublicClient({
      transport: http(rpcUrl, { batch: true }),
      batch: { multicall: true },
    });
    const user = getAddress(walletAddress);

    try {
      const contracts: any[] = [];
      if (stethAddr) {
        contracts.push({
          address: stethAddr,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [user],
        });
      }
      if (wstethAddr) {
        contracts.push({
          address: wstethAddr,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [user],
        });
      }

      const results = await client.multicall({ contracts });

      const assets: PositionAsset[] = [];
      let totalValueUsd = 0;
      let idx = 0;

      // Get ETH price for USD conversion (stETH ~= ETH price)
      let ethPriceUsd = 0;
      try {
        const adapter = context.getChainAdapterForChain(chainId);
        const ethToken = await adapter.resolveToken(chainId, "ETH");
        if (ethToken?.coingeckoId) {
          const priceRes = await fetch(
            `https://api.coingecko.com/api/v3/simple/price?ids=${ethToken.coingeckoId}&vs_currencies=usd`
          );
          if (priceRes.ok) {
            const priceData = await priceRes.json();
            ethPriceUsd = priceData[ethToken.coingeckoId]?.usd || 0;
          }
        }
      } catch {
        // Price lookup failed, report 0 USD
      }

      if (stethAddr) {
        const bal = (results[idx]?.result as bigint) ?? 0n;
        idx++;
        if (bal > 0n) {
          const balance = Number(formatUnits(bal, 18));
          const usd = balance * ethPriceUsd;
          totalValueUsd += usd;
          assets.push({
            symbol: "stETH",
            address: stethAddr,
            balance: balance.toFixed(6),
            balanceUsd: usd,
          });
        }
      }

      if (wstethAddr) {
        const bal = (results[idx]?.result as bigint) ?? 0n;
        idx++;
        if (bal > 0n) {
          const balance = Number(formatUnits(bal, 18));
          // wstETH trades at a premium over stETH (~1.17x), approximate
          const wstethPriceUsd = ethPriceUsd * 1.17;
          const usd = balance * wstethPriceUsd;
          totalValueUsd += usd;
          assets.push({
            symbol: "wstETH",
            address: wstethAddr,
            balance: balance.toFixed(6),
            balanceUsd: usd,
          });
        }
      }

      if (assets.length === 0) return [];

      return [
        {
          protocol: "Lido",
          type: "staking",
          chainId,
          chainName: chain.name,
          assets,
          totalValueUsd,
        },
      ];
    } catch {
      return [];
    }
  }
}
