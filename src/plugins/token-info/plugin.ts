import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";
import { TokenNotFoundError } from "../../core/errors.js";
import { TokenInfoInputSchema, TokenPriceInputSchema } from "../../tools/schemas.js";
import { CoinGeckoClient } from "./coingecko.js";

export class TokenInfoPlugin implements DefiPlugin {
  readonly name = "token-info";
  readonly description = "Token metadata and price lookups";
  readonly version = "1.0.0";

  private coingecko!: CoinGeckoClient;

  constructor(private apiKey?: string) {}

  async initialize(_context: PluginContext): Promise<void> {
    this.coingecko = new CoinGeckoClient(this.apiKey);
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "defi_token_info",
        description:
          "Get token details including name, symbol, decimals, and contract address. Accepts a token symbol (e.g. 'USDC') or contract address.",
        inputSchema: TokenInfoInputSchema,
        handler: async (input: unknown, context: PluginContext): Promise<ToolResult> => {
          const { chainId, token } = input as { chainId: string; token: string };
          const adapter = context.getChainAdapterForChain(chainId);
          const tokenInfo = await adapter.resolveToken(chainId, token);

          if (!tokenInfo) {
            throw new TokenNotFoundError(token, chainId);
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(tokenInfo, null, 2),
              },
            ],
          };
        },
      },
      {
        name: "defi_token_price",
        description:
          "Get current USD price, 24h change, and market cap for one or more tokens. Pass an array of { chainId, token } objects.",
        inputSchema: TokenPriceInputSchema,
        handler: async (input: unknown, context: PluginContext): Promise<ToolResult> => {
          const { tokens } = input as {
            tokens: Array<{ chainId: string; token: string }>;
          };

          // Resolve all tokens first
          const resolvedTokens = await Promise.all(
            tokens.map(async ({ chainId, token }) => {
              const adapter = context.getChainAdapterForChain(chainId);
              const resolved = await adapter.resolveToken(chainId, token);
              if (!resolved) {
                throw new TokenNotFoundError(token, chainId);
              }
              return resolved;
            })
          );

          const prices = await this.coingecko.getTokenPrices(resolvedTokens);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(prices, null, 2),
              },
            ],
          };
        },
      },
    ];
  }
}
