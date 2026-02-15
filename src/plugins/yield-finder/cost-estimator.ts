import { createPublicClient, http, formatUnits } from "viem";
import type { PluginContext } from "../../core/types.js";
import { CoinGeckoClient } from "../token-info/coingecko.js";

/** Estimated gas units for common DeFi operations */
const GAS_ESTIMATES: Record<string, number> = {
  aave_supply: 250_000,
  aave_withdraw: 300_000,
  erc20_approve: 50_000,
};

/** Li.Fi chain ID mapping */
const LIFI_CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  polygon: 137,
  arbitrum: 42161,
  base: 8453,
  optimism: 10,
  avalanche: 43114,
  bsc: 56,
};

/**
 * Estimate gas cost in USD for a transaction on a given chain.
 * Uses heuristic gas amounts (not eth_estimateGas) for speed.
 */
export async function estimateGasCostUsd(
  chainId: string,
  operation: string,
  context: PluginContext
): Promise<number> {
  const chain = context.getChainAdapterForChain(chainId).getChain(chainId);
  if (!chain) return 0;

  const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
  const client = createPublicClient({ transport: http(rpcUrl) });

  const gasUnits = GAS_ESTIMATES[operation] ?? 250_000;

  try {
    const gasPrice = await client.getGasPrice();
    const gasCostNative = Number(formatUnits(gasPrice * BigInt(gasUnits), 18));

    // Get native token price
    if (chain.nativeToken.coingeckoId) {
      const cg = new CoinGeckoClient(context.config.apiKeys.coingecko);
      const prices = await cg.getPricesByIds([chain.nativeToken.coingeckoId]);
      const nativePrice =
        prices[chain.nativeToken.coingeckoId]?.usd ?? 0;
      return gasCostNative * nativePrice;
    }
  } catch {
    // Fallback heuristics per chain
    const fallbacks: Record<string, number> = {
      ethereum: 5.0,
      polygon: 0.01,
      arbitrum: 0.10,
      base: 0.01,
      optimism: 0.05,
      avalanche: 0.10,
    };
    return fallbacks[chainId] ?? 0.5;
  }

  return 0;
}

/**
 * Estimate bridge cost in USD using Li.Fi API.
 * Returns 0 if bridging is not needed or fails.
 */
export async function estimateBridgeCostUsd(
  fromChainId: string,
  toChainId: string,
  tokenSymbol: string,
  amount: string,
  context: PluginContext
): Promise<number> {
  if (fromChainId === toChainId) return 0;

  const fromNum = LIFI_CHAIN_IDS[fromChainId];
  const toNum = LIFI_CHAIN_IDS[toChainId];
  if (!fromNum || !toNum) return 0;

  // Resolve token on source chain
  const adapter = context.getChainAdapterForChain(fromChainId);
  const token = await adapter.resolveToken(fromChainId, tokenSymbol);
  if (!token) return 0;

  // Resolve token on dest chain
  const dstAdapter = context.getChainAdapterForChain(toChainId);
  const dstToken = await dstAdapter.resolveToken(toChainId, tokenSymbol);
  if (!dstToken) return 0;

  const rawAmount = BigInt(
    Math.floor(parseFloat(amount) * 10 ** token.decimals)
  ).toString();

  try {
    // Use a well-known public address for quote only
    const vitalik = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    const url =
      `https://li.quest/v1/quote?fromChain=${fromNum}&toChain=${toNum}` +
      `&fromToken=${token.address}&toToken=${dstToken.address}` +
      `&fromAmount=${rawAmount}&fromAddress=${vitalik}&slippage=0.005`;

    const resp = await fetch(url);
    if (!resp.ok) return 0;

    const data = (await resp.json()) as any;
    const gasCosts = data?.estimate?.gasCosts;
    if (Array.isArray(gasCosts) && gasCosts.length > 0) {
      return gasCosts.reduce(
        (sum: number, gc: any) => sum + parseFloat(gc.amountUSD || "0"),
        0
      );
    }

    // If no gas costs, estimate from fee
    const feeCosts = data?.estimate?.feeCosts;
    if (Array.isArray(feeCosts) && feeCosts.length > 0) {
      return feeCosts.reduce(
        (sum: number, fc: any) => sum + parseFloat(fc.amountUSD || "0"),
        0
      );
    }
  } catch {
    // Bridge estimation failed, return conservative estimate
  }

  return 0;
}
