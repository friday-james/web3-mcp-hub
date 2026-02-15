import type { PluginContext } from "./types.js";

export interface YieldOpportunity {
  protocol: string;
  chainId: string;
  chainName: string;
  asset: string;
  assetAddress: string;
  apy: number;
  apyType: "variable" | "stable" | "fixed";
  tvl?: number;
  riskLevel: "low" | "medium" | "high";
  /** Category: lending, staking, lp, vault */
  category: string;
  metadata?: Record<string, unknown>;
}

/**
 * Interface for protocol-specific yield sources.
 * Implement this to add a new yield source to the intent engine.
 *
 * Usage:
 *   1. Create a class implementing YieldSource
 *   2. Call registry.registerYieldSource(new MySource()) in src/index.ts
 *   3. The yield finder tool auto-discovers it
 */
export interface YieldSource {
  readonly protocolName: string;
  readonly supportedChains: string[];

  /** Get yield opportunities for a given token across supported chains */
  getYieldOpportunities(
    tokenSymbol: string,
    context: PluginContext
  ): Promise<YieldOpportunity[]>;
}
