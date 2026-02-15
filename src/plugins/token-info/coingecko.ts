import type { TokenPrice, TokenInfo } from "../../core/types.js";

const BASE_URL = "https://api.coingecko.com/api/v3";

/** Platform IDs used by CoinGecko for each chain */
const PLATFORM_MAP: Record<string, string> = {
  ethereum: "ethereum",
  base: "base",
  arbitrum: "arbitrum-one",
  polygon: "polygon-pos",
  optimism: "optimistic-ethereum",
  avalanche: "avalanche",
  bsc: "binance-smart-chain",
  "solana-mainnet": "solana",
  "osmosis-1": "osmosis",
  "cosmoshub-4": "cosmos",
};

export class CoinGeckoClient {
  private headers: Record<string, string>;

  constructor(apiKey?: string) {
    this.headers = {
      accept: "application/json",
    };
    if (apiKey) {
      this.headers["x-cg-demo-api-key"] = apiKey;
    }
  }

  /** Get price by CoinGecko ID */
  async getPricesByIds(
    coingeckoIds: string[]
  ): Promise<Record<string, { usd: number; usd_24h_change?: number; usd_market_cap?: number; usd_24h_vol?: number }>> {
    if (coingeckoIds.length === 0) return {};
    const ids = coingeckoIds.join(",");
    const url = `${BASE_URL}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`;
    const res = await fetch(url, { headers: this.headers });
    if (!res.ok) throw new Error(`CoinGecko API error: ${res.status}`);
    return res.json();
  }

  /** Get price by contract address on a specific platform */
  async getPriceByContract(
    chainId: string,
    contractAddress: string
  ): Promise<{
    usd: number;
    usd_24h_change?: number;
    usd_market_cap?: number;
  } | null> {
    const platform = PLATFORM_MAP[chainId];
    if (!platform) return null;

    const url = `${BASE_URL}/simple/token_price/${platform}?contract_addresses=${contractAddress}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`;
    const res = await fetch(url, { headers: this.headers });
    if (!res.ok) return null;

    const data = await res.json();
    const addr = contractAddress.toLowerCase();
    return data[addr] || null;
  }

  /** Build TokenPrice objects from tokens that have coingeckoIds */
  async getTokenPrices(tokens: TokenInfo[]): Promise<TokenPrice[]> {
    const results: TokenPrice[] = [];

    // Group tokens with coingecko IDs
    const withIds = tokens.filter((t) => t.coingeckoId);
    const withoutIds = tokens.filter((t) => !t.coingeckoId);

    // Batch fetch by coingecko ID
    if (withIds.length > 0) {
      const ids = withIds.map((t) => t.coingeckoId!);
      const prices = await this.getPricesByIds(ids);
      for (const token of withIds) {
        const price = prices[token.coingeckoId!];
        if (price) {
          results.push({
            token,
            priceUsd: price.usd,
            priceChange24h: price.usd_24h_change,
            marketCap: price.usd_market_cap,
            volume24h: price.usd_24h_vol,
            lastUpdated: new Date().toISOString(),
          });
        }
      }
    }

    // For tokens without IDs, try by contract address
    for (const token of withoutIds) {
      const price = await this.getPriceByContract(
        token.chainId,
        token.address
      );
      if (price) {
        results.push({
          token,
          priceUsd: price.usd,
          priceChange24h: price.usd_24h_change,
          marketCap: price.usd_market_cap,
          lastUpdated: new Date().toISOString(),
        });
      }
    }

    return results;
  }
}
