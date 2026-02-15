import type { AppConfig } from "./core/types.js";

export function loadConfig(): AppConfig {
  return {
    rpcUrls: {
      ethereum: process.env.RPC_ETHEREUM || "https://eth.llamarpc.com",
      base: process.env.RPC_BASE || "https://mainnet.base.org",
      arbitrum: process.env.RPC_ARBITRUM || "https://arb1.arbitrum.io/rpc",
      polygon: process.env.RPC_POLYGON || "https://polygon-rpc.com",
      optimism: process.env.RPC_OPTIMISM || "https://mainnet.optimism.io",
      "solana-mainnet":
        process.env.RPC_SOLANA || "https://api.mainnet-beta.solana.com",
      "osmosis-1":
        process.env.RPC_OSMOSIS || "https://rpc.osmosis.zone",
      "cosmoshub-4":
        process.env.RPC_COSMOSHUB || "https://rpc.cosmos.network",
    },
    apiKeys: {
      coingecko: process.env.COINGECKO_API_KEY,
    },
    defaultSlippageBps: parseInt(
      process.env.DEFAULT_SLIPPAGE_BPS || "50",
      10
    ),
  };
}
