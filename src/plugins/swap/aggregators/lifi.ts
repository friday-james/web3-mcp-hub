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

const LIFI_API = "https://li.quest/v1";

/** Map our chain IDs to Li.Fi numeric chain IDs */
const CHAIN_ID_MAP: Record<string, number> = {
  ethereum: 1,
  polygon: 137,
  arbitrum: 42161,
  base: 8453,
  optimism: 10,
  avalanche: 43114,
  bsc: 56,
};

export class LiFiAggregator implements SwapAggregator {
  readonly name = "li.fi";

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
      fromChain: numericChainId.toString(),
      toChain: numericChainId.toString(),
      fromToken: request.srcToken,
      toToken: request.dstToken,
      fromAmount: parseTokenAmount(request.amount, 18), // Will be overridden by resolved decimals
      // Li.Fi requires a valid non-zero fromAddress even for quotes
      fromAddress: request.userAddress || "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    });

    if (request.slippageBps) {
      params.set("slippage", (request.slippageBps / 10000).toString());
    }

    const res = await fetch(`${LIFI_API}/quote?${params}`);
    if (!res.ok) {
      const err = await res.text();
      throw new AggregatorError(this.name, `Quote failed: ${err}`);
    }

    const data = await res.json();
    const action = data.action;
    const estimate = data.estimate;

    const srcToken: TokenInfo = {
      symbol: action.fromToken.symbol,
      name: action.fromToken.name,
      decimals: action.fromToken.decimals,
      address: action.fromToken.address,
      chainId: chain.id,
      logoUrl: action.fromToken.logoURI,
    };

    const dstToken: TokenInfo = {
      symbol: action.toToken.symbol,
      name: action.toToken.name,
      decimals: action.toToken.decimals,
      address: action.toToken.address,
      chainId: chain.id,
      logoUrl: action.toToken.logoURI,
    };

    return {
      srcToken,
      dstToken,
      amountIn: formatTokenAmount(
        estimate.fromAmount,
        action.fromToken.decimals
      ),
      amountOut: formatTokenAmount(
        estimate.toAmount,
        action.toToken.decimals
      ),
      minimumAmountOut: formatTokenAmount(
        estimate.toAmountMin,
        action.toToken.decimals
      ),
      estimatedGas: estimate.gasCosts?.[0]?.estimate,
      route: estimate.toolData
        ? [estimate.toolData.name || data.tool]
        : [data.tool],
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
      fromChain: numericChainId.toString(),
      toChain: numericChainId.toString(),
      fromToken: request.srcToken,
      toToken: request.dstToken,
      fromAmount: parseTokenAmount(request.amount, 18),
      fromAddress: request.userAddress,
    });

    if (request.slippageBps) {
      params.set("slippage", (request.slippageBps / 10000).toString());
    }

    const res = await fetch(`${LIFI_API}/quote?${params}`);
    if (!res.ok) {
      const err = await res.text();
      throw new AggregatorError(this.name, `Build tx failed: ${err}`);
    }

    const data = await res.json();
    const tx = data.transactionRequest;
    const estimate = data.estimate;
    const action = data.action;

    return {
      chainId: chain.id,
      ecosystem: "evm",
      raw: {
        to: tx.to,
        data: tx.data,
        value: tx.value,
        gasLimit: tx.gasLimit,
        gasPrice: tx.gasPrice,
        chainId: numericChainId,
      },
      description: `Swap ${formatTokenAmount(estimate.fromAmount, action.fromToken.decimals)} ${action.fromToken.symbol} for ~${formatTokenAmount(estimate.toAmount, action.toToken.decimals)} ${action.toToken.symbol} via Li.Fi`,
      estimatedGas: estimate.gasCosts?.[0]?.estimate,
    };
  }
}
