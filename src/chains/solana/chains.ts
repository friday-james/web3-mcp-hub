import type { ChainInfo } from "../../core/types.js";

export const NATIVE_SOL_MINT = "So11111111111111111111111111111111111111112";

export const SOLANA_CHAINS: ChainInfo[] = [
  {
    id: "solana-mainnet",
    name: "Solana",
    ecosystem: "solana",
    nativeChainId: "mainnet-beta",
    nativeToken: {
      symbol: "SOL",
      name: "Solana",
      decimals: 9,
      address: NATIVE_SOL_MINT,
      chainId: "solana-mainnet",
      coingeckoId: "solana",
    },
    rpcUrl: "https://api.mainnet-beta.solana.com",
    explorerUrl: "https://solscan.io",
  },
];
