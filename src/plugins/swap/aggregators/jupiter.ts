import type { SwapAggregator } from "./types.js";
import type {
  SwapQuote,
  SwapRequest,
  UnsignedTransaction,
  ChainInfo,
  TokenInfo,
} from "../../../core/types.js";
import { AggregatorError } from "../../../core/errors.js";
import { parseTokenAmount, formatTokenAmount } from "../../../core/utils.js";

const JUPITER_API = "https://api.jup.ag";

export class JupiterAggregator implements SwapAggregator {
  readonly name = "jupiter";

  getSupportedChainIds(): string[] {
    return ["solana-mainnet"];
  }

  async getQuote(
    request: SwapRequest,
    _chain: ChainInfo
  ): Promise<SwapQuote> {
    const url = new URL(`${JUPITER_API}/swap/v1/quote`);
    url.searchParams.set("inputMint", request.srcToken);
    url.searchParams.set("outputMint", request.dstToken);
    // Jupiter expects amounts in smallest unit
    url.searchParams.set("amount", request.amount);
    url.searchParams.set(
      "slippageBps",
      String(request.slippageBps || 50)
    );
    url.searchParams.set("restrictIntermediateTokens", "true");

    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.text();
      throw new AggregatorError(this.name, `Quote failed: ${err}`);
    }

    const data = await res.json();

    // Build route description from routePlan
    const route = (data.routePlan || []).map(
      (step: { swapInfo: { label: string } }) => step.swapInfo?.label || "unknown"
    );

    const srcToken: TokenInfo = {
      symbol: request.srcToken.slice(0, 6),
      name: request.srcToken.slice(0, 6),
      decimals: 0,
      address: request.srcToken,
      chainId: "solana-mainnet",
    };

    const dstToken: TokenInfo = {
      symbol: request.dstToken.slice(0, 6),
      name: request.dstToken.slice(0, 6),
      decimals: 0,
      address: request.dstToken,
      chainId: "solana-mainnet",
    };

    return {
      srcToken,
      dstToken,
      amountIn: data.inAmount,
      amountOut: data.outAmount,
      minimumAmountOut: data.otherAmountThreshold,
      priceImpact: data.priceImpactPct,
      route,
      aggregator: this.name,
    };
  }

  async buildTransaction(
    request: SwapRequest,
    chain: ChainInfo
  ): Promise<UnsignedTransaction> {
    // Step 1: get quote
    const quoteUrl = new URL(`${JUPITER_API}/swap/v1/quote`);
    quoteUrl.searchParams.set("inputMint", request.srcToken);
    quoteUrl.searchParams.set("outputMint", request.dstToken);
    quoteUrl.searchParams.set("amount", request.amount);
    quoteUrl.searchParams.set(
      "slippageBps",
      String(request.slippageBps || 50)
    );
    quoteUrl.searchParams.set("restrictIntermediateTokens", "true");

    const quoteRes = await fetch(quoteUrl);
    if (!quoteRes.ok) {
      const err = await quoteRes.text();
      throw new AggregatorError(this.name, `Quote failed: ${err}`);
    }
    const quoteData = await quoteRes.json();

    // Step 2: build swap transaction
    const swapRes = await fetch(`${JUPITER_API}/swap/v1/swap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quoteData,
        userPublicKey: request.userAddress,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: "auto",
      }),
    });

    if (!swapRes.ok) {
      const err = await swapRes.text();
      throw new AggregatorError(this.name, `Build tx failed: ${err}`);
    }

    const swapData = await swapRes.json();

    return {
      chainId: "solana-mainnet",
      ecosystem: "solana",
      raw: {
        serializedTransaction: swapData.swapTransaction,
      },
      description: `Swap via Jupiter on Solana (${quoteData.inAmount} → ${quoteData.outAmount})`,
    };
  }
}
