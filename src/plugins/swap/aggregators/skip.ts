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

const SKIP_API = "https://api.skip.build";

export class SkipGoAggregator implements SwapAggregator {
  readonly name = "skip-go";

  getSupportedChainIds(): string[] {
    return ["osmosis-1", "cosmoshub-4"];
  }

  async getQuote(
    request: SwapRequest,
    chain: ChainInfo
  ): Promise<SwapQuote> {
    const cosmosChainId = chain.nativeChainId as string;
    const amountRaw = parseTokenAmount(request.amount, 6);

    const routeRes = await fetch(`${SKIP_API}/v2/fungible/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount_in: amountRaw,
        source_asset_denom: request.srcToken,
        source_asset_chain_id: cosmosChainId,
        dest_asset_denom: request.dstToken,
        dest_asset_chain_id: cosmosChainId,
        allow_multi_tx: false,
        smart_relay: false,
      }),
    });

    if (!routeRes.ok) {
      const err = await routeRes.text();
      throw new AggregatorError(this.name, `Route failed: ${err}`);
    }

    const data = await routeRes.json();

    const srcToken: TokenInfo = {
      symbol: data.source_asset_denom || request.srcToken,
      name: data.source_asset_denom || request.srcToken,
      decimals: 6,
      address: request.srcToken,
      chainId: chain.id,
    };

    const dstToken: TokenInfo = {
      symbol: data.dest_asset_denom || request.dstToken,
      name: data.dest_asset_denom || request.dstToken,
      decimals: 6,
      address: request.dstToken,
      chainId: chain.id,
    };

    // Extract route description from operations
    const route = (data.operations || []).map(
      (op: { type?: string; swap_venue?: { name: string } }) =>
        op.swap_venue?.name || op.type || "transfer"
    );

    return {
      srcToken,
      dstToken,
      amountIn: request.amount,
      amountOut: formatTokenAmount(data.amount_out || "0", 6),
      minimumAmountOut: formatTokenAmount(data.amount_out || "0", 6),
      estimatedGas: data.estimated_fees?.[0]?.amount,
      route: route.length > 0 ? route : ["skip-go"],
      aggregator: this.name,
    };
  }

  async buildTransaction(
    request: SwapRequest,
    chain: ChainInfo
  ): Promise<UnsignedTransaction> {
    const cosmosChainId = chain.nativeChainId as string;
    const amountRaw = parseTokenAmount(request.amount, 6);

    const slippagePercent = ((request.slippageBps || 50) / 100).toString();

    const msgsRes = await fetch(`${SKIP_API}/v2/fungible/msgs_direct`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount_in: amountRaw,
        source_asset_denom: request.srcToken,
        source_asset_chain_id: cosmosChainId,
        dest_asset_denom: request.dstToken,
        dest_asset_chain_id: cosmosChainId,
        chain_ids_to_addresses: {
          [cosmosChainId]: request.userAddress,
        },
        slippage_tolerance_percent: slippagePercent,
        allow_multi_tx: false,
        smart_relay: false,
      }),
    });

    if (!msgsRes.ok) {
      const err = await msgsRes.text();
      throw new AggregatorError(this.name, `Build tx failed: ${err}`);
    }

    const data = await msgsRes.json();

    return {
      chainId: chain.id,
      ecosystem: "cosmos",
      raw: {
        msgs: data.msgs,
        memo: "Swap via Skip Go",
      },
      description: `Swap ${request.amount} ${request.srcToken} via Skip Go on ${chain.name}`,
    };
  }
}
