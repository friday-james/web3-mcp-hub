import type { z } from "zod";
import type { ProtocolScanner } from "./scanner-types.js";
import type { YieldSource } from "./yield-types.js";

// ============================================================
// Chain Types
// ============================================================

export type ChainEcosystem = "evm" | "solana" | "cosmos";

export interface ChainInfo {
  id: string;
  name: string;
  ecosystem: ChainEcosystem;
  nativeChainId: string | number;
  nativeToken: TokenInfo;
  rpcUrl: string;
  explorerUrl?: string;
}

// ============================================================
// Token Types
// ============================================================

export interface TokenInfo {
  symbol: string;
  name: string;
  decimals: number;
  /** Contract address (EVM), mint address (Solana), denom (Cosmos) */
  address: string;
  chainId: string;
  logoUrl?: string;
  coingeckoId?: string;
}

export interface TokenBalance {
  token: TokenInfo;
  balanceRaw: string;
  balanceFormatted: string;
  balanceUsd?: string;
}

export interface TokenPrice {
  token: TokenInfo;
  priceUsd: number;
  priceChange24h?: number;
  marketCap?: number;
  volume24h?: number;
  lastUpdated: string;
}

// ============================================================
// Transaction Types
// ============================================================

export interface UnsignedTransaction {
  chainId: string;
  ecosystem: ChainEcosystem;
  /** Ecosystem-specific transaction data */
  raw: Record<string, unknown>;
  description: string;
  estimatedGas?: string;
}

// ============================================================
// Swap Types
// ============================================================

export interface SwapQuote {
  srcToken: TokenInfo;
  dstToken: TokenInfo;
  amountIn: string;
  amountOut: string;
  minimumAmountOut: string;
  priceImpact?: string;
  estimatedGas?: string;
  route: string[];
  aggregator: string;
  expiresAt?: string;
}

export interface SwapRequest {
  chainId: string;
  srcToken: string;
  dstToken: string;
  amount: string;
  slippageBps?: number;
  userAddress: string;
}

// ============================================================
// Chain Adapter Interface
// ============================================================

export interface ChainAdapter {
  readonly ecosystem: ChainEcosystem;

  getSupportedChains(): ChainInfo[];
  getChain(chainId: string): ChainInfo | undefined;
  isValidAddress(chainId: string, address: string): boolean;
  getNativeBalance(chainId: string, address: string): Promise<TokenBalance>;
  getTokenBalance(
    chainId: string,
    address: string,
    tokenAddress: string
  ): Promise<TokenBalance>;
  getTokenBalances(
    chainId: string,
    address: string,
    tokenAddresses: string[]
  ): Promise<TokenBalance[]>;
  resolveToken(
    chainId: string,
    symbolOrAddress: string
  ): Promise<TokenInfo | undefined>;
}

// ============================================================
// Plugin Interface
// ============================================================

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodType<unknown>;
  handler: (input: unknown, context: PluginContext) => Promise<ToolResult>;
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface PluginContext {
  getChainAdapter(ecosystem: ChainEcosystem): ChainAdapter;
  getChainAdapterForChain(chainId: string): ChainAdapter;
  getAllChains(): ChainInfo[];
  config: AppConfig;
  getScanners(): ProtocolScanner[];
  getYieldSources(): YieldSource[];
}

export interface PluginMetadata {
  author?: string;
  repository?: string;
  tags?: string[];
  supportedChains?: string[];
}

export interface DefiPlugin {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly metadata?: PluginMetadata;

  initialize(context: PluginContext): Promise<void>;
  getTools(): ToolDefinition[];
  shutdown?(): Promise<void>;
}

// ============================================================
// Configuration
// ============================================================

export interface AppConfig {
  rpcUrls: Record<string, string>;
  apiKeys: {
    coingecko?: string;
  };
  defaultSlippageBps: number;
}
