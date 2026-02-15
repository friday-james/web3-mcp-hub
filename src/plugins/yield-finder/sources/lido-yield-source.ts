import type { YieldSource, YieldOpportunity } from "../../../core/yield-types.js";
import type { PluginContext } from "../../../core/types.js";

const LIDO_APR_API = "https://eth-api.lido.fi/v1/protocol/steth/apr/last";

const WSTETH_ADDRESSES: Record<string, string> = {
  ethereum: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
  arbitrum: "0x5979D7b546E38E414F7E9822514be443A4800529",
  optimism: "0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb",
  base: "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452",
  polygon: "0x03b54A6e9a984069379fae1a4fC4dBAE93B3bCCD",
};

const MATCH_TOKENS = ["ETH", "WETH", "STETH", "WSTETH"];

export class LidoYieldSource implements YieldSource {
  readonly protocolName = "Lido";
  readonly supportedChains = Object.keys(WSTETH_ADDRESSES);

  async getYieldOpportunities(
    tokenSymbol: string,
    context: PluginContext
  ): Promise<YieldOpportunity[]> {
    if (!MATCH_TOKENS.includes(tokenSymbol.toUpperCase())) return [];

    // Fetch current APR from Lido API
    let apr: number;
    try {
      const res = await fetch(LIDO_APR_API);
      if (!res.ok) return [];
      const data = await res.json();
      apr = parseFloat(data.data?.apr ?? data.apr ?? "0");
    } catch {
      return [];
    }

    if (apr <= 0) return [];

    return this.supportedChains
      .map((chainId) => {
        const chain = context
          .getChainAdapterForChain(chainId)
          .getChain(chainId);
        if (!chain) return null;

        return {
          protocol: "Lido",
          chainId,
          chainName: chain.name,
          asset: chainId === "ethereum" ? "stETH" : "wstETH",
          assetAddress: WSTETH_ADDRESSES[chainId],
          apy: apr,
          apyType: "variable" as const,
          riskLevel: "low" as const,
          category: "staking",
          metadata: {
            mechanism: "liquid staking",
            token: chainId === "ethereum" ? "stETH" : "wstETH",
          },
        };
      })
      .filter(Boolean) as YieldOpportunity[];
  }
}
