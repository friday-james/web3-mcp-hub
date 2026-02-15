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

const ZEROX_API = "https://api.0x.org/swap/permit2";

const CHAIN_ID_MAP: Record<string, number> = {
  ethereum: 1,
  polygon: 137,
  arbitrum: 42161,
  base: 8453,
  optimism: 10,
  avalanche: 43114,
  bsc: 56,
};

export class ZeroXAggregator implements SwapAggregator {
  readonly name = "0x";

  constructor(private apiKey?: string) {}

  getSupportedChainIds(): string[] {
    return Object.keys(CHAIN_ID_MAP);
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["0x-api-key"] = this.apiKey;
    }
    return headers;
  }

  async getQuote(
    request: SwapRequest,
    chain: ChainInfo
  ): Promise<SwapQuote> {
    const numericChainId = CHAIN_ID_MAP[chain.id];
    if (!numericChainId) {
      throw new AggregatorError(this.name, `Chain "${chain.id}" not supported`);
    }

    const params = new URLSearchParams({
      chainId: numericChainId.toString(),
      sellToken: request.srcToken,
      buyToken: request.dstToken,
      sellAmount: parseTokenAmount(request.amount, 18),
      taker: request.userAddress || "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    });

    if (request.slippageBps) {
      params.set(
        "slippagePercentage",
        (request.slippageBps / 10000).toString()
      );
    }

    const res = await fetch(`${ZEROX_API}/quote?${params}`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new AggregatorError(this.name, `Quote failed: ${err}`);
    }

    const data = await res.json();

    const srcToken: TokenInfo = {
      symbol: data.sellToken?.symbol || "???",
      name: data.sellToken?.name || "",
      decimals: data.sellToken?.decimals || 18,
      address: request.srcToken,
      chainId: chain.id,
    };

    const dstToken: TokenInfo = {
      symbol: data.buyToken?.symbol || "???",
      name: data.buyToken?.name || "",
      decimals: data.buyToken?.decimals || 18,
      address: request.dstToken,
      chainId: chain.id,
    };

    const sellDecimals = srcToken.decimals;
    const buyDecimals = dstToken.decimals;

    return {
      srcToken,
      dstToken,
      amountIn: formatTokenAmount(data.sellAmount || "0", sellDecimals),
      amountOut: formatTokenAmount(data.buyAmount || "0", buyDecimals),
      minimumAmountOut: formatTokenAmount(
        data.minBuyAmount || data.buyAmount || "0",
        buyDecimals
      ),
      estimatedGas: data.gas || data.estimatedGas,
      route: data.route?.fills?.map((f: any) => f.source) || ["0x"],
      aggregator: this.name,
    };
  }

  async buildTransaction(
    request: SwapRequest,
    chain: ChainInfo
  ): Promise<UnsignedTransaction> {
    const numericChainId = CHAIN_ID_MAP[chain.id];
    if (!numericChainId) {
      throw new AggregatorError(this.name, `Chain "${chain.id}" not supported`);
    }

    const params = new URLSearchParams({
      chainId: numericChainId.toString(),
      sellToken: request.srcToken,
      buyToken: request.dstToken,
      sellAmount: parseTokenAmount(request.amount, 18),
      taker: request.userAddress,
    });

    if (request.slippageBps) {
      params.set(
        "slippagePercentage",
        (request.slippageBps / 10000).toString()
      );
    }

    const res = await fetch(`${ZEROX_API}/quote?${params}`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new AggregatorError(this.name, `Build tx failed: ${err}`);
    }

    const data = await res.json();
    const tx = data.transaction;

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
      description: `Swap ${request.amount} via 0x on ${chain.name}`,
      estimatedGas: tx.gas,
    };
  }
}
