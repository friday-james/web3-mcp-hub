import type { SwapAggregator } from "./types.js";
import type {
  SwapQuote,
  SwapRequest,
  UnsignedTransaction,
  ChainInfo,
  TokenInfo,
} from "../../../core/types.js";
import { AggregatorError } from "../../../core/errors.js";
import { formatTokenAmount } from "../../../core/utils.js";

const ONEINCH_API = "https://api.1inch.dev/swap/v6.0";

const CHAIN_ID_MAP: Record<string, number> = {
  ethereum: 1,
  polygon: 137,
  arbitrum: 42161,
  base: 8453,
  optimism: 10,
  avalanche: 43114,
  bsc: 56,
};

export class OneInchAggregator implements SwapAggregator {
  readonly name = "1inch";

  getSupportedChainIds(): string[] {
    return Object.keys(CHAIN_ID_MAP);
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
      src: request.srcToken,
      dst: request.dstToken,
      amount: request.amount,
      includeTokensInfo: "true",
      includeGas: "true",
    });

    const res = await fetch(
      `${ONEINCH_API}/${numericChainId}/quote?${params}`,
      { headers: { accept: "application/json" } }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new AggregatorError(this.name, `Quote failed: ${err}`);
    }

    const data = await res.json();

    const srcToken: TokenInfo = {
      symbol: data.srcToken?.symbol || request.srcToken.slice(0, 6),
      name: data.srcToken?.name || "",
      decimals: data.srcToken?.decimals || 18,
      address: request.srcToken,
      chainId: chain.id,
    };

    const dstToken: TokenInfo = {
      symbol: data.dstToken?.symbol || request.dstToken.slice(0, 6),
      name: data.dstToken?.name || "",
      decimals: data.dstToken?.decimals || 18,
      address: request.dstToken,
      chainId: chain.id,
    };

    return {
      srcToken,
      dstToken,
      amountIn: formatTokenAmount(data.srcAmount || request.amount, srcToken.decimals),
      amountOut: formatTokenAmount(data.dstAmount, dstToken.decimals),
      minimumAmountOut: formatTokenAmount(data.dstAmount, dstToken.decimals),
      estimatedGas: data.gas?.toString(),
      route: data.protocols
        ? data.protocols.flat(3).map((p: any) => p.name || "1inch")
        : ["1inch"],
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
      src: request.srcToken,
      dst: request.dstToken,
      amount: request.amount,
      from: request.userAddress,
      slippage: ((request.slippageBps || 50) / 100).toString(),
      includeTokensInfo: "true",
    });

    const res = await fetch(
      `${ONEINCH_API}/${numericChainId}/swap?${params}`,
      { headers: { accept: "application/json" } }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new AggregatorError(this.name, `Build tx failed: ${err}`);
    }

    const data = await res.json();
    const tx = data.tx;

    const srcDecimals = data.srcToken?.decimals || 18;
    const dstDecimals = data.dstToken?.decimals || 18;
    const srcSymbol = data.srcToken?.symbol || "?";
    const dstSymbol = data.dstToken?.symbol || "?";

    return {
      chainId: chain.id,
      ecosystem: "evm",
      raw: {
        to: tx.to,
        data: tx.data,
        value: tx.value,
        gasLimit: tx.gas?.toString(),
        chainId: numericChainId,
      },
      description: `Swap ${formatTokenAmount(data.srcAmount, srcDecimals)} ${srcSymbol} for ~${formatTokenAmount(data.dstAmount, dstDecimals)} ${dstSymbol} via 1inch`,
      estimatedGas: tx.gas?.toString(),
    };
  }
}
