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

const PARASWAP_API = "https://apiv5.paraswap.io";

const CHAIN_ID_MAP: Record<string, number> = {
  ethereum: 1,
  polygon: 137,
  arbitrum: 42161,
  base: 8453,
  optimism: 10,
  avalanche: 43114,
  bsc: 56,
};

export class ParaSwapAggregator implements SwapAggregator {
  readonly name = "paraswap";

  getSupportedChainIds(): string[] {
    return Object.keys(CHAIN_ID_MAP);
  }

  private async getPriceRoute(
    request: SwapRequest,
    numericChainId: number
  ): Promise<any> {
    const params = new URLSearchParams({
      srcToken: request.srcToken,
      destToken: request.dstToken,
      amount: parseTokenAmount(request.amount, 18),
      network: numericChainId.toString(),
      side: "SELL",
    });

    const res = await fetch(`${PARASWAP_API}/prices?${params}`);
    if (!res.ok) {
      const err = await res.text();
      throw new AggregatorError(this.name, `Price quote failed: ${err}`);
    }

    const data = await res.json();
    return data.priceRoute;
  }

  async getQuote(
    request: SwapRequest,
    chain: ChainInfo
  ): Promise<SwapQuote> {
    const numericChainId = CHAIN_ID_MAP[chain.id];
    if (!numericChainId) {
      throw new AggregatorError(
        this.name,
        `Chain "${chain.id}" not supported`
      );
    }

    const priceRoute = await this.getPriceRoute(request, numericChainId);

    const srcDecimals = priceRoute.srcDecimals || 18;
    const dstDecimals = priceRoute.destDecimals || 18;

    const srcToken: TokenInfo = {
      symbol: priceRoute.srcToken?.symbol || "???",
      name: priceRoute.srcToken?.name || "",
      decimals: srcDecimals,
      address: request.srcToken,
      chainId: chain.id,
    };

    const dstToken: TokenInfo = {
      symbol: priceRoute.destToken?.symbol || "???",
      name: priceRoute.destToken?.name || "",
      decimals: dstDecimals,
      address: request.dstToken,
      chainId: chain.id,
    };

    return {
      srcToken,
      dstToken,
      amountIn: formatTokenAmount(priceRoute.srcAmount || "0", srcDecimals),
      amountOut: formatTokenAmount(priceRoute.destAmount || "0", dstDecimals),
      minimumAmountOut: formatTokenAmount(
        priceRoute.destAmount || "0",
        dstDecimals
      ),
      estimatedGas: priceRoute.gasCost,
      route: priceRoute.bestRoute?.map(
        (r: any) =>
          r.swaps?.[0]?.swapExchanges?.[0]?.exchange || "paraswap"
      ) || ["paraswap"],
      aggregator: this.name,
    };
  }

  async buildTransaction(
    request: SwapRequest,
    chain: ChainInfo
  ): Promise<UnsignedTransaction> {
    const numericChainId = CHAIN_ID_MAP[chain.id];
    if (!numericChainId) {
      throw new AggregatorError(
        this.name,
        `Chain "${chain.id}" not supported`
      );
    }

    // Step 1: Get price route
    const priceRoute = await this.getPriceRoute(request, numericChainId);

    // Step 2: Build transaction
    const slippage = request.slippageBps || 50;
    const body = {
      srcToken: request.srcToken,
      destToken: request.dstToken,
      srcAmount: priceRoute.srcAmount,
      destAmount: priceRoute.destAmount,
      priceRoute,
      userAddress: request.userAddress,
      partner: "defi-mcp",
      slippage: slippage / 100, // ParaSwap uses percentage
    };

    const res = await fetch(
      `${PARASWAP_API}/transactions/${numericChainId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) {
      const err = await res.text();
      throw new AggregatorError(this.name, `Build tx failed: ${err}`);
    }

    const tx = await res.json();

    return {
      chainId: chain.id,
      ecosystem: "evm",
      raw: {
        to: tx.to,
        data: tx.data,
        value: tx.value,
        gasLimit: tx.gas || tx.gasLimit,
        gasPrice: tx.gasPrice,
        chainId: numericChainId,
      },
      description: `Swap ${request.amount} via ParaSwap on ${chain.name}`,
      estimatedGas: tx.gas,
    };
  }
}
