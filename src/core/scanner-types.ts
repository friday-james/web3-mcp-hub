import type { PluginContext } from "./types.js";

export interface ProtocolPosition {
  protocol: string;
  type:
    | "lending-supply"
    | "lending-borrow"
    | "lp"
    | "staking"
    | "native"
    | "erc20"
    | "prediction-market";
  chainId: string;
  chainName: string;
  assets: PositionAsset[];
  totalValueUsd: number;
  metadata?: Record<string, unknown>;
}

export interface PositionAsset {
  symbol: string;
  address: string;
  balance: string;
  balanceUsd: number;
  apy?: number;
  /** True for debt positions (e.g. borrows) */
  isDebt?: boolean;
}

/**
 * Interface for protocol-specific wallet scanners.
 * Implement this to add a new protocol to wallet intelligence.
 *
 * Usage:
 *   1. Create a class implementing ProtocolScanner
 *   2. Call registry.registerScanner(new MyScanner()) in src/index.ts
 *   3. The wallet scan tool auto-discovers it
 */
export interface ProtocolScanner {
  readonly protocolName: string;
  readonly supportedChains: string[];

  /** Scan a wallet for positions in this protocol on a specific chain */
  scanPositions(
    chainId: string,
    walletAddress: string,
    context: PluginContext
  ): Promise<ProtocolPosition[]>;
}
