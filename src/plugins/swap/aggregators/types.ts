import type {
  SwapQuote,
  SwapRequest,
  UnsignedTransaction,
  ChainInfo,
} from "../../../core/types.js";

export interface SwapAggregator {
  readonly name: string;
  getSupportedChainIds(): string[];
  getQuote(request: SwapRequest, chain: ChainInfo): Promise<SwapQuote>;
  buildTransaction(
    request: SwapRequest,
    chain: ChainInfo
  ): Promise<UnsignedTransaction>;
}
