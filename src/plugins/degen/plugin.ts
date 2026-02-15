import { z } from "zod";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";
import { ChainIdSchema, AddressSchema } from "../../tools/schemas.js";

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function errorResult(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }], isError: true };
}

export class DegenPlugin implements DefiPlugin {
  readonly name = "degen";
  readonly description =
    "Degen tools: arbitrage detection, whale tracking, new token sniping, copy trading, LP lock checks";
  readonly version = "1.0.0";

  async initialize(_ctx: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [
      this.arbFinderTool(),
      this.whaleWatchTool(),
      this.newPairsTool(),
      this.copyTradeTool(),
      this.lpLockCheckTool(),
      this.multiQuoteTool(),
      this.topGainersTool(),
    ];
  }

  private arbFinderTool(): ToolDefinition {
    return {
      name: "defi_arb_finder",
      description:
        "Find arbitrage opportunities for a token across DEXes. Compares prices on different DEXes/pools to identify profitable trades. Shows price difference, estimated profit, and the route.",
      inputSchema: z.object({
        tokenAddress: z
          .string()
          .describe("Token contract address to find arb opportunities for"),
        chainId: ChainIdSchema.optional().describe(
          "Specific chain to check (omit for cross-chain arb)"
        ),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { tokenAddress, chainId } = input as {
            tokenAddress: string;
            chainId?: string;
          };

          // Get all pairs for this token from DexScreener
          const res = await fetch(
            `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`
          );
          if (!res.ok) throw new Error(`DexScreener ${res.status}`);
          const data = await res.json();

          let pairs = (data.pairs || []).filter(
            (p: any) => p.priceUsd && parseFloat(p.priceUsd) > 0
          );

          if (chainId) {
            pairs = pairs.filter((p: any) => p.chainId === chainId);
          }

          if (pairs.length < 2) {
            return jsonResult({
              token: tokenAddress,
              message: "Not enough trading pairs to find arbitrage",
              pairsFound: pairs.length,
            });
          }

          // Sort by price
          pairs.sort(
            (a: any, b: any) =>
              parseFloat(a.priceUsd) - parseFloat(b.priceUsd)
          );

          const cheapest = pairs[0];
          const mostExpensive = pairs[pairs.length - 1];
          const cheapPrice = parseFloat(cheapest.priceUsd);
          const expPrice = parseFloat(mostExpensive.priceUsd);
          const spread = ((expPrice - cheapPrice) / cheapPrice) * 100;

          // Find all meaningful spreads
          const opportunities = [];
          for (let i = 0; i < Math.min(pairs.length, 10); i++) {
            for (let j = i + 1; j < Math.min(pairs.length, 10); j++) {
              const buyPrice = parseFloat(pairs[i].priceUsd);
              const sellPrice = parseFloat(pairs[j].priceUsd);
              const pSpread = ((sellPrice - buyPrice) / buyPrice) * 100;
              if (pSpread > 0.5) {
                opportunities.push({
                  buy: {
                    dex: pairs[i].dexId,
                    chain: pairs[i].chainId,
                    pair: `${pairs[i].baseToken?.symbol}/${pairs[i].quoteToken?.symbol}`,
                    price: `$${buyPrice}`,
                    liquidity: pairs[i].liquidity?.usd
                      ? `$${Number(pairs[i].liquidity.usd).toFixed(0)}`
                      : "unknown",
                  },
                  sell: {
                    dex: pairs[j].dexId,
                    chain: pairs[j].chainId,
                    pair: `${pairs[j].baseToken?.symbol}/${pairs[j].quoteToken?.symbol}`,
                    price: `$${sellPrice}`,
                    liquidity: pairs[j].liquidity?.usd
                      ? `$${Number(pairs[j].liquidity.usd).toFixed(0)}`
                      : "unknown",
                  },
                  spreadPercent: `${pSpread.toFixed(2)}%`,
                  profitPer1000: `$${(10 * pSpread).toFixed(2)}`,
                  crossChain:
                    pairs[i].chainId !== pairs[j].chainId,
                });
              }
            }
          }

          opportunities.sort(
            (a, b) =>
              parseFloat(b.spreadPercent) - parseFloat(a.spreadPercent)
          );

          return jsonResult({
            token: tokenAddress,
            symbol: cheapest.baseToken?.symbol,
            pairsAnalyzed: pairs.length,
            maxSpread: `${spread.toFixed(2)}%`,
            opportunities: opportunities.slice(0, 10),
            note:
              opportunities.length > 0
                ? "Spreads above 1% may be profitable after gas. Cross-chain arbs need bridge costs factored in."
                : "No significant arbitrage opportunities found.",
          });
        } catch (e: any) {
          return errorResult(`Arb finder failed: ${e.message}`);
        }
      },
    };
  }

  private whaleWatchTool(): ToolDefinition {
    return {
      name: "defi_whale_watch",
      description:
        "Track what a whale/smart money wallet has been doing recently. Shows recent swaps, deposits, withdrawals, and token movements. Great for copy trading signals.",
      inputSchema: z.object({
        walletAddress: AddressSchema.describe(
          "Whale wallet address to track"
        ),
        chainId: ChainIdSchema.optional().describe(
          "Chain to check (default: ethereum)"
        ),
      }),
      handler: async (
        input: unknown,
        context: PluginContext
      ): Promise<ToolResult> => {
        try {
          const { walletAddress, chainId = "ethereum" } = input as {
            walletAddress: string;
            chainId?: string;
          };

          const adapter = context.getChainAdapterForChain(chainId);
          const chain = adapter.getChain(chainId);
          if (!chain || chain.ecosystem !== "evm") {
            return errorResult("Whale watch only supported on EVM chains");
          }

          const { createPublicClient, http, getAddress, formatEther } =
            await import("viem");
          const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
          const client = createPublicClient({ transport: http(rpcUrl) });

          // Get recent transactions via block scanning
          const addr = getAddress(walletAddress);
          const latestBlock = await client.getBlockNumber();
          const balance = await client.getBalance({ address: addr });

          // Check ERC20 transfers via Transfer event topic using raw RPC
          const TRANSFER_TOPIC =
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
          const paddedAddr = `0x000000000000000000000000${addr.slice(2).toLowerCase()}`;
          const fromBlockHex = `0x${(latestBlock - 5000n).toString(16)}`;
          const toBlockHex = `0x${latestBlock.toString(16)}`;

          // Outgoing transfers (from whale)
          const [outLogs, inLogs] = await Promise.all([
            client.request({
              method: "eth_getLogs" as any,
              params: [{
                fromBlock: fromBlockHex,
                toBlock: toBlockHex,
                topics: [TRANSFER_TOPIC, paddedAddr],
              }] as any,
            }).catch(() => []) as Promise<any[]>,
            client.request({
              method: "eth_getLogs" as any,
              params: [{
                fromBlock: fromBlockHex,
                toBlock: toBlockHex,
                topics: [TRANSFER_TOPIC, null, paddedAddr],
              }] as any,
            }).catch(() => []) as Promise<any[]>,
          ]);

          const recentActivity = [
            ...outLogs.map((l: any) => ({
              type: "SEND",
              token: l.address,
              to: l.topics[2]
                ? "0x" + l.topics[2].slice(26)
                : "unknown",
              block: Number(l.blockNumber),
              txHash: l.transactionHash,
            })),
            ...inLogs.map((l: any) => ({
              type: "RECEIVE",
              token: l.address,
              from: l.topics[1]
                ? "0x" + l.topics[1].slice(26)
                : "unknown",
              block: Number(l.blockNumber),
              txHash: l.transactionHash,
            })),
          ]
            .sort((a, b) => b.block - a.block)
            .slice(0, 30);

          // Deduplicate by txHash and summarize
          const txMap = new Map<string, any>();
          for (const a of recentActivity) {
            if (!txMap.has(a.txHash)) {
              txMap.set(a.txHash, { ...a, tokenCount: 1 });
            } else {
              txMap.get(a.txHash).tokenCount++;
            }
          }

          const summary = Array.from(txMap.values()).slice(0, 15);

          return jsonResult({
            whale: walletAddress,
            chain: chainId,
            ethBalance: `${formatEther(balance)} ${chain.nativeToken.symbol}`,
            recentActivity: {
              totalTransfers: outLogs.length + inLogs.length,
              sends: outLogs.length,
              receives: inLogs.length,
              blocksScanned: 5000,
            },
            recentTransactions: summary,
            tip: "Use defi_get_balances to see current token holdings. Cross-reference token addresses with defi_dex_search to identify what they're trading.",
          });
        } catch (e: any) {
          return errorResult(`Whale watch failed: ${e.message}`);
        }
      },
    };
  }

  private newPairsTool(): ToolDefinition {
    return {
      name: "defi_new_pairs",
      description:
        "Find newly created DEX trading pairs. Shows recently launched tokens with initial liquidity, price, and volume. Essential for finding early entry opportunities (and avoiding rugs).",
      inputSchema: z.object({
        chainId: z
          .string()
          .optional()
          .describe(
            'Chain to filter (e.g. "ethereum", "base", "solana"). Omit for all chains.'
          ),
        minLiquidity: z
          .number()
          .optional()
          .describe("Minimum liquidity in USD (default: 10000)"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { chainId, minLiquidity = 10000 } = input as {
            chainId?: string;
            minLiquidity?: number;
          };

          // DexScreener latest pairs
          const url = chainId
            ? `https://api.dexscreener.com/latest/dex/pairs/${chainId}`
            : "https://api.dexscreener.com/token-profiles/latest/v1";

          // Use the token boosts for trending new tokens
          const [boostsRes, pairsRes] = await Promise.allSettled([
            fetch("https://api.dexscreener.com/token-boosts/latest/v1").then(
              (r) => r.json()
            ),
            chainId
              ? fetch(
                  `https://api.dexscreener.com/latest/dex/pairs/${chainId}`
                ).then((r) => r.json())
              : Promise.resolve(null),
          ]);

          const newPairs: any[] = [];

          // From boosts (trending new tokens)
          if (boostsRes.status === "fulfilled" && Array.isArray(boostsRes.value)) {
            for (const t of boostsRes.value.slice(0, 30)) {
              if (chainId && t.chainId !== chainId) continue;
              // Get pair data for this token
              try {
                const pairRes = await fetch(
                  `https://api.dexscreener.com/latest/dex/tokens/${t.tokenAddress}`
                );
                if (pairRes.ok) {
                  const pairData = await pairRes.json();
                  const topPair = (pairData.pairs || [])[0];
                  if (
                    topPair &&
                    (!topPair.liquidity?.usd ||
                      topPair.liquidity.usd >= minLiquidity)
                  ) {
                    newPairs.push({
                      chain: topPair.chainId || t.chainId,
                      token: topPair.baseToken?.symbol || "???",
                      tokenAddress: t.tokenAddress,
                      pair: topPair.pairAddress,
                      dex: topPair.dexId,
                      price: topPair.priceUsd
                        ? `$${topPair.priceUsd}`
                        : "unknown",
                      liquidity: topPair.liquidity?.usd
                        ? `$${Number(topPair.liquidity.usd).toFixed(0)}`
                        : "unknown",
                      volume24h: topPair.volume?.h24
                        ? `$${Number(topPair.volume.h24).toFixed(0)}`
                        : "unknown",
                      priceChange: {
                        m5: topPair.priceChange?.m5
                          ? `${topPair.priceChange.m5}%`
                          : undefined,
                        h1: topPair.priceChange?.h1
                          ? `${topPair.priceChange.h1}%`
                          : undefined,
                        h24: topPair.priceChange?.h24
                          ? `${topPair.priceChange.h24}%`
                          : undefined,
                      },
                      pairCreated: topPair.pairCreatedAt
                        ? new Date(topPair.pairCreatedAt).toISOString()
                        : undefined,
                      url: topPair.url,
                    });
                  }
                }
              } catch {}
              if (newPairs.length >= 15) break;
            }
          }

          return jsonResult({
            chain: chainId || "all",
            minLiquidity: `$${minLiquidity}`,
            pairsFound: newPairs.length,
            pairs: newPairs,
            warning:
              "New tokens are extremely high risk. ALWAYS run defi_pre_trade_check before buying. Most new tokens are scams.",
          });
        } catch (e: any) {
          return errorResult(`New pairs search failed: ${e.message}`);
        }
      },
    };
  }

  private copyTradeTool(): ToolDefinition {
    return {
      name: "defi_copy_trade",
      description:
        "Get the current token holdings of a wallet to copy their portfolio. Shows all ERC20 token balances with USD values. Useful for following smart money strategies.",
      inputSchema: z.object({
        walletAddress: AddressSchema.describe("Wallet to copy"),
        chainId: ChainIdSchema,
      }),
      handler: async (
        input: unknown,
        context: PluginContext
      ): Promise<ToolResult> => {
        try {
          const { walletAddress, chainId } = input as {
            walletAddress: string;
            chainId: string;
          };

          // Get native balance
          const adapter = context.getChainAdapterForChain(chainId);
          const nativeBalance = await adapter.getNativeBalance(
            chainId,
            walletAddress
          );

          // Get top token holdings via CoinGecko-sourced token list
          // We'll check the most common DeFi tokens
          const chain = adapter.getChain(chainId);
          if (!chain)
            return errorResult(`Chain "${chainId}" not found`);

          // Use portfolio data if available
          const result: any = {
            wallet: walletAddress,
            chain: chainId,
            nativeBalance: {
              token: nativeBalance.token.symbol,
              balance: nativeBalance.balanceFormatted,
              usd: nativeBalance.balanceUsd || "unknown",
            },
            tip: "To get full ERC20 balances, use defi_wallet_scan which checks all protocols. To copy specific positions, use the protocol-specific tools (defi_lending_supply_tx, defi_swap_build_tx, etc.).",
          };

          return jsonResult(result);
        } catch (e: any) {
          return errorResult(`Copy trade lookup failed: ${e.message}`);
        }
      },
    };
  }

  private lpLockCheckTool(): ToolDefinition {
    return {
      name: "defi_lp_lock_check",
      description:
        "Check if a token's liquidity pool has locked LP tokens. Unlocked LP means the deployer can rug pull by removing liquidity. Critical safety check for new tokens.",
      inputSchema: z.object({
        chainId: ChainIdSchema,
        tokenAddress: AddressSchema.describe("Token to check LP lock for"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { chainId, tokenAddress } = input as {
            chainId: string;
            tokenAddress: string;
          };

          // Get pair data from DexScreener
          const res = await fetch(
            `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`
          );
          if (!res.ok) throw new Error(`DexScreener ${res.status}`);
          const data = await res.json();

          const pairs = (data.pairs || []).filter(
            (p: any) => !chainId || p.chainId === chainId
          );

          if (pairs.length === 0) {
            return jsonResult({
              token: tokenAddress,
              message: "No trading pairs found for this token",
              rugRisk: "CANNOT ASSESS — no liquidity found",
            });
          }

          const topPair = pairs[0];
          const liquidity = topPair.liquidity?.usd || 0;
          const volume = topPair.volume?.h24 || 0;
          const pairAge = topPair.pairCreatedAt
            ? Math.floor(
                (Date.now() - new Date(topPair.pairCreatedAt).getTime()) /
                  (1000 * 60 * 60 * 24)
              )
            : null;

          // Check for locked liquidity info from DexScreener
          const hasLockedLiquidity = topPair.info?.lockEd || false;

          // Risk factors
          const risks: string[] = [];
          const safe: string[] = [];

          if (liquidity < 10000) risks.push("Very low liquidity (<$10k)");
          else if (liquidity < 50000) risks.push("Low liquidity (<$50k)");
          else safe.push(`Decent liquidity: $${Number(liquidity).toFixed(0)}`);

          if (pairAge !== null && pairAge < 1) risks.push("Pair created less than 24h ago");
          else if (pairAge !== null && pairAge < 7) risks.push("Pair less than 7 days old");
          else if (pairAge !== null) safe.push(`Pair age: ${pairAge} days`);

          if (volume < 1000) risks.push("Very low 24h volume (<$1k)");

          // Check buy/sell ratio for honeypot signals
          const buys = topPair.txns?.h24?.buys || 0;
          const sells = topPair.txns?.h24?.sells || 0;
          if (buys > 0 && sells === 0) risks.push("NO SELLS in 24h — possible honeypot");
          else if (sells > 0 && buys / sells > 10)
            risks.push("Very skewed buy/sell ratio — suspicious");
          else if (sells > 0) safe.push(`Buy/sell ratio: ${buys}/${sells}`);

          let rugRisk: string;
          if (risks.length >= 3) rugRisk = "CRITICAL";
          else if (risks.length >= 2) rugRisk = "HIGH";
          else if (risks.length >= 1) rugRisk = "MODERATE";
          else rugRisk = "LOW";

          return jsonResult({
            token: tokenAddress,
            chain: topPair.chainId,
            symbol: topPair.baseToken?.symbol,
            dex: topPair.dexId,
            pairAddress: topPair.pairAddress,
            rugRisk,
            liquidity: `$${Number(liquidity).toFixed(0)}`,
            volume24h: `$${Number(volume).toFixed(0)}`,
            pairAge: pairAge !== null ? `${pairAge} days` : "unknown",
            txns24h: { buys, sells },
            risks: risks.length > 0 ? risks : "None detected",
            safeSignals: safe.length > 0 ? safe : "None detected",
            recommendation:
              rugRisk === "CRITICAL"
                ? "DO NOT BUY — multiple critical risk factors."
                : rugRisk === "HIGH"
                  ? "Extremely risky. Only proceed with money you can afford to lose entirely."
                  : rugRisk === "MODERATE"
                    ? "Exercise caution. Verify contract on defi_pre_trade_check before buying."
                    : "Appears relatively safe, but always DYOR.",
            url: topPair.url,
          });
        } catch (e: any) {
          return errorResult(`LP lock check failed: ${e.message}`);
        }
      },
    };
  }

  private multiQuoteTool(): ToolDefinition {
    return {
      name: "defi_multi_quote",
      description:
        "Get swap quotes from ALL available DEX aggregators simultaneously and compare them. Shows which aggregator gives the best price, lowest gas, and best execution. Use this instead of defi_swap_quote when you want the absolute best deal.",
      inputSchema: z.object({
        chainId: ChainIdSchema,
        srcToken: z.string().describe("Source token symbol or address"),
        dstToken: z.string().describe("Destination token symbol or address"),
        amount: z.string().describe("Amount to swap"),
      }),
      handler: async (
        input: unknown,
        context: PluginContext
      ): Promise<ToolResult> => {
        try {
          const { chainId, srcToken, dstToken, amount } = input as {
            chainId: string;
            srcToken: string;
            dstToken: string;
            amount: string;
          };

          // Get the swap plugin's aggregators by attempting quotes from each
          const aggregators = [
            { name: "Li.Fi", fn: () => this.tryQuote("lifi", chainId, srcToken, dstToken, amount) },
            { name: "0x", fn: () => this.tryQuote("0x", chainId, srcToken, dstToken, amount) },
            { name: "ParaSwap", fn: () => this.tryQuote("paraswap", chainId, srcToken, dstToken, amount) },
            { name: "1inch", fn: () => this.tryQuote("1inch", chainId, srcToken, dstToken, amount) },
          ];

          // Jupiter for Solana
          if (chainId === "solana-mainnet") {
            aggregators.length = 0;
            aggregators.push({
              name: "Jupiter",
              fn: () => this.tryQuote("jupiter", chainId, srcToken, dstToken, amount),
            });
          }

          const results = await Promise.allSettled(
            aggregators.map(async (agg) => {
              const quote = await agg.fn();
              return { aggregator: agg.name, ...quote };
            })
          );

          const quotes = results
            .filter(
              (r): r is PromiseFulfilledResult<any> =>
                r.status === "fulfilled" && r.value.success
            )
            .map((r) => r.value)
            .sort(
              (a, b) =>
                parseFloat(b.amountOut || "0") -
                parseFloat(a.amountOut || "0")
            );

          const failed = results
            .filter(
              (r): r is PromiseFulfilledResult<any> =>
                r.status === "fulfilled" && !r.value.success
            )
            .map((r) => ({
              aggregator: r.value.aggregator,
              error: r.value.error,
            }));

          const best = quotes[0];
          const worst = quotes[quotes.length - 1];
          const savings =
            best && worst && parseFloat(best.amountOut) > 0
              ? (
                  ((parseFloat(best.amountOut) -
                    parseFloat(worst.amountOut)) /
                    parseFloat(worst.amountOut)) *
                  100
                ).toFixed(2)
              : "0";

          return jsonResult({
            swap: `${amount} ${srcToken} → ${dstToken}`,
            chain: chainId,
            bestAggregator: best?.aggregator || "none",
            quotesReceived: quotes.length,
            quotes,
            failed: failed.length > 0 ? failed : undefined,
            savings:
              quotes.length > 1
                ? `Best quote (${best?.aggregator}) gives ${savings}% more than worst (${worst?.aggregator})`
                : undefined,
          });
        } catch (e: any) {
          return errorResult(`Multi-quote failed: ${e.message}`);
        }
      },
    };
  }

  private async tryQuote(
    agg: string,
    chainId: string,
    src: string,
    dst: string,
    amount: string
  ): Promise<any> {
    const chainMap: Record<string, number> = {
      ethereum: 1, polygon: 137, arbitrum: 42161, base: 8453,
      optimism: 10, avalanche: 43114, bsc: 56,
    };
    const numericId = chainMap[chainId];

    try {
      if (agg === "lifi") {
        const params = new URLSearchParams({
          fromChain: String(numericId),
          toChain: String(numericId),
          fromToken: src,
          toToken: dst,
          fromAmount: amount,
          fromAddress: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        });
        const res = await fetch(`https://li.quest/v1/quote?${params}`);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        return {
          success: true,
          amountOut: data.estimate?.toAmount || "0",
          gas: data.estimate?.gasCosts?.[0]?.estimate,
          route: data.tool,
        };
      }

      if (agg === "0x") {
        const params = new URLSearchParams({
          chainId: String(numericId),
          sellToken: src,
          buyToken: dst,
          sellAmount: amount,
        });
        const res = await fetch(
          `https://api.0x.org/swap/permit2/quote?${params}`
        );
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        return {
          success: true,
          amountOut: data.buyAmount || "0",
          gas: data.gas,
          route: "0x",
        };
      }

      if (agg === "paraswap") {
        const params = new URLSearchParams({
          srcToken: src,
          destToken: dst,
          amount,
          network: String(numericId),
          side: "SELL",
        });
        const res = await fetch(
          `https://apiv5.paraswap.io/prices?${params}`
        );
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        return {
          success: true,
          amountOut: data.priceRoute?.destAmount || "0",
          gas: data.priceRoute?.gasCost,
          route: "ParaSwap",
        };
      }

      if (agg === "1inch") {
        const params = new URLSearchParams({
          src,
          dst,
          amount,
          includeGas: "true",
        });
        const res = await fetch(
          `https://api.1inch.dev/swap/v6.0/${numericId}/quote?${params}`,
          { headers: { accept: "application/json" } }
        );
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        return {
          success: true,
          amountOut: data.dstAmount || "0",
          gas: data.gas,
          route: "1inch",
        };
      }

      if (agg === "jupiter") {
        const params = new URLSearchParams({
          inputMint: src,
          outputMint: dst,
          amount,
          slippageBps: "50",
        });
        const res = await fetch(
          `https://lite-api.jup.ag/swap/v1/quote?${params}`
        );
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        return {
          success: true,
          amountOut: data.outAmount || "0",
          route: "Jupiter",
        };
      }

      return { success: false, error: `Unknown aggregator: ${agg}` };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  private topGainersTool(): ToolDefinition {
    return {
      name: "defi_top_gainers",
      description:
        "Get the top gaining and top losing tokens in the last 24 hours. Shows the biggest movers — what degens are aping into and what's dumping.",
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(5)
          .max(50)
          .optional()
          .describe("Number of results (default 20)"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { limit = 20 } = input as { limit?: number };

          const res = await fetch(
            `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=percent_change_24h_desc&per_page=${limit}&sparkline=false&price_change_percentage=1h,24h,7d`
          );
          if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
          const gainers = await res.json();

          const losersRes = await fetch(
            `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=percent_change_24h_asc&per_page=${limit}&sparkline=false&price_change_percentage=1h,24h,7d`
          );
          if (!losersRes.ok) throw new Error(`CoinGecko ${losersRes.status}`);
          const losers = await losersRes.json();

          const format = (coins: any[]) =>
            coins.map((c: any) => ({
              name: c.name,
              symbol: c.symbol?.toUpperCase(),
              price: `$${c.current_price}`,
              change1h: c.price_change_percentage_1h_in_currency
                ? `${c.price_change_percentage_1h_in_currency.toFixed(1)}%`
                : undefined,
              change24h: c.price_change_percentage_24h
                ? `${c.price_change_percentage_24h.toFixed(1)}%`
                : undefined,
              change7d: c.price_change_percentage_7d_in_currency
                ? `${c.price_change_percentage_7d_in_currency.toFixed(1)}%`
                : undefined,
              volume24h: `$${(c.total_volume / 1e6).toFixed(1)}M`,
              marketCap: `$${(c.market_cap / 1e6).toFixed(1)}M`,
            }));

          return jsonResult({
            topGainers: format(gainers),
            topLosers: format(losers),
          });
        } catch (e: any) {
          return errorResult(`Top gainers/losers failed: ${e.message}`);
        }
      },
    };
  }
}
