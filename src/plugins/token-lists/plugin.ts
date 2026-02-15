import { z } from "zod";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";
import { ChainIdSchema } from "../../tools/schemas.js";

const CHAIN_ID_MAP: Record<string, number> = {
  ethereum: 1,
  polygon: 137,
  arbitrum: 42161,
  base: 8453,
  optimism: 10,
  avalanche: 43114,
  bsc: 56,
};

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function errorResult(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }], isError: true };
}

export class TokenListsPlugin implements DefiPlugin {
  readonly name = "token-lists";
  readonly description = "Search and lookup token addresses across chains";
  readonly version = "1.0.0";

  async initialize(_ctx: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [this.searchTool(), this.popularTokensTool()];
  }

  private searchTool(): ToolDefinition {
    return {
      name: "defi_token_search",
      description:
        "Search for token contract addresses by name or symbol. Useful for finding the correct contract address before making swaps, transfers, or other operations.",
      inputSchema: z.object({
        query: z.string().describe("Token name or symbol to search (e.g. 'USDC', 'Uniswap', 'PEPE')"),
        chainId: ChainIdSchema.optional().describe("Filter results to a specific chain"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { query, chainId } = input as { query: string; chainId?: string };

          // Use CoinGecko search
          const res = await fetch(
            `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`,
            { headers: { accept: "application/json" } }
          );
          if (!res.ok) throw new Error(`Search API ${res.status}`);
          const data = await res.json();

          const coins = (data.coins || []).slice(0, 10);

          // For each coin, try to get platform addresses
          const results = coins.map((c: any) => {
            const platforms: Record<string, string> = {};
            if (c.platforms) {
              for (const [platform, addr] of Object.entries(c.platforms)) {
                if (addr) platforms[platform] = addr as string;
              }
            }
            return {
              name: c.name,
              symbol: c.symbol?.toUpperCase(),
              coingeckoId: c.id,
              marketCapRank: c.market_cap_rank,
              platforms: Object.keys(platforms).length > 0 ? platforms : undefined,
            };
          });

          // If chainId specified, try to get detailed token info
          if (chainId && coins.length > 0) {
            const topCoinId = coins[0].id;
            try {
              const detailRes = await fetch(
                `https://api.coingecko.com/api/v3/coins/${topCoinId}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false`,
                { headers: { accept: "application/json" } }
              );
              if (detailRes.ok) {
                const detail = await detailRes.json();
                const platformMap: Record<string, string> = {
                  ethereum: "ethereum",
                  "polygon-pos": "polygon",
                  "arbitrum-one": "arbitrum",
                  "base": "base",
                  "optimistic-ethereum": "optimism",
                  "avalanche": "avalanche",
                  "binance-smart-chain": "bsc",
                };

                for (const [platform, addr] of Object.entries(detail.platforms || {})) {
                  const mappedChain = platformMap[platform];
                  if (mappedChain === chainId && addr) {
                    results[0].contractAddress = addr as string;
                    results[0].chainMatch = chainId;
                  }
                }
              }
            } catch {}
          }

          return jsonResult({ query, resultCount: results.length, tokens: results });
        } catch (e: any) {
          return errorResult(`Token search failed: ${e.message}`);
        }
      },
    };
  }

  private popularTokensTool(): ToolDefinition {
    return {
      name: "defi_popular_tokens",
      description:
        "Get a curated list of popular/commonly used token addresses for a specific chain. Includes stablecoins, major DeFi tokens, and wrapped native tokens.",
      inputSchema: z.object({
        chainId: ChainIdSchema,
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const { chainId } = input as { chainId: string };

        const POPULAR_TOKENS: Record<string, Array<{ symbol: string; name: string; address: string; decimals: number }>> = {
          ethereum: [
            { symbol: "USDC", name: "USD Coin", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
            { symbol: "USDT", name: "Tether USD", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
            { symbol: "DAI", name: "Dai Stablecoin", address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18 },
            { symbol: "WETH", name: "Wrapped Ether", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
            { symbol: "WBTC", name: "Wrapped BTC", address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8 },
            { symbol: "UNI", name: "Uniswap", address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", decimals: 18 },
            { symbol: "LINK", name: "Chainlink", address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", decimals: 18 },
            { symbol: "AAVE", name: "Aave", address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", decimals: 18 },
            { symbol: "stETH", name: "Lido Staked ETH", address: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84", decimals: 18 },
            { symbol: "wstETH", name: "Wrapped stETH", address: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0", decimals: 18 },
            { symbol: "COMP", name: "Compound", address: "0xc00e94Cb662C3520282E6f5717214004A7f26888", decimals: 18 },
            { symbol: "MKR", name: "Maker", address: "0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2", decimals: 18 },
            { symbol: "sDAI", name: "Savings Dai", address: "0x83F20F44975D03b1b09e64809B757c47f942BEeA", decimals: 18 },
            { symbol: "rETH", name: "Rocket Pool ETH", address: "0xae78736Cd615f374D3085123A210448E74Fc6393", decimals: 18 },
          ],
          arbitrum: [
            { symbol: "USDC", name: "USD Coin", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
            { symbol: "USDT", name: "Tether USD", address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 },
            { symbol: "WETH", name: "Wrapped Ether", address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18 },
            { symbol: "WBTC", name: "Wrapped BTC", address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", decimals: 8 },
            { symbol: "ARB", name: "Arbitrum", address: "0x912CE59144191C1204E64559FE8253a0e49E6548", decimals: 18 },
            { symbol: "GMX", name: "GMX", address: "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a", decimals: 18 },
            { symbol: "wstETH", name: "Wrapped stETH", address: "0x5979D7b546E38E414F7E9822514be443A4800529", decimals: 18 },
          ],
          base: [
            { symbol: "USDC", name: "USD Coin", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
            { symbol: "WETH", name: "Wrapped Ether", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
            { symbol: "cbETH", name: "Coinbase Wrapped Staked ETH", address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", decimals: 18 },
            { symbol: "DAI", name: "Dai Stablecoin", address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18 },
          ],
          optimism: [
            { symbol: "USDC", name: "USD Coin", address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6 },
            { symbol: "USDT", name: "Tether USD", address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimals: 6 },
            { symbol: "WETH", name: "Wrapped Ether", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
            { symbol: "OP", name: "Optimism", address: "0x4200000000000000000000000000000000000042", decimals: 18 },
            { symbol: "wstETH", name: "Wrapped stETH", address: "0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb", decimals: 18 },
          ],
          polygon: [
            { symbol: "USDC", name: "USD Coin", address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 },
            { symbol: "USDT", name: "Tether USD", address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 },
            { symbol: "WMATIC", name: "Wrapped MATIC", address: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", decimals: 18 },
            { symbol: "WETH", name: "Wrapped Ether", address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", decimals: 18 },
            { symbol: "WBTC", name: "Wrapped BTC", address: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6", decimals: 8 },
          ],
        };

        const tokens = POPULAR_TOKENS[chainId];
        if (!tokens) {
          return {
            content: [{
              type: "text",
              text: `No curated token list for "${chainId}". Available: ${Object.keys(POPULAR_TOKENS).join(", ")}`,
            }],
            isError: true,
          };
        }

        return jsonResult({ chain: chainId, tokenCount: tokens.length, tokens });
      },
    };
  }
}
