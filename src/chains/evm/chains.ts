import type { ChainInfo } from "../../core/types.js";

/** Sentinel address used to represent the native token on EVM chains */
export const NATIVE_TOKEN_ADDRESS =
  "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

export const EVM_CHAINS: ChainInfo[] = [
  {
    id: "ethereum",
    name: "Ethereum",
    ecosystem: "evm",
    nativeChainId: 1,
    nativeToken: {
      symbol: "ETH",
      name: "Ether",
      decimals: 18,
      address: NATIVE_TOKEN_ADDRESS,
      chainId: "ethereum",
      coingeckoId: "ethereum",
    },
    rpcUrl: "https://eth.llamarpc.com",
    explorerUrl: "https://etherscan.io",
  },
  {
    id: "base",
    name: "Base",
    ecosystem: "evm",
    nativeChainId: 8453,
    nativeToken: {
      symbol: "ETH",
      name: "Ether",
      decimals: 18,
      address: NATIVE_TOKEN_ADDRESS,
      chainId: "base",
      coingeckoId: "ethereum",
    },
    rpcUrl: "https://mainnet.base.org",
    explorerUrl: "https://basescan.org",
  },
  {
    id: "arbitrum",
    name: "Arbitrum One",
    ecosystem: "evm",
    nativeChainId: 42161,
    nativeToken: {
      symbol: "ETH",
      name: "Ether",
      decimals: 18,
      address: NATIVE_TOKEN_ADDRESS,
      chainId: "arbitrum",
      coingeckoId: "ethereum",
    },
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    explorerUrl: "https://arbiscan.io",
  },
  {
    id: "polygon",
    name: "Polygon",
    ecosystem: "evm",
    nativeChainId: 137,
    nativeToken: {
      symbol: "POL",
      name: "POL",
      decimals: 18,
      address: NATIVE_TOKEN_ADDRESS,
      chainId: "polygon",
      coingeckoId: "matic-network",
    },
    rpcUrl: "https://polygon-rpc.com",
    explorerUrl: "https://polygonscan.com",
  },
  {
    id: "optimism",
    name: "Optimism",
    ecosystem: "evm",
    nativeChainId: 10,
    nativeToken: {
      symbol: "ETH",
      name: "Ether",
      decimals: 18,
      address: NATIVE_TOKEN_ADDRESS,
      chainId: "optimism",
      coingeckoId: "ethereum",
    },
    rpcUrl: "https://mainnet.optimism.io",
    explorerUrl: "https://optimistic.etherscan.io",
  },
  {
    id: "avalanche",
    name: "Avalanche C-Chain",
    ecosystem: "evm",
    nativeChainId: 43114,
    nativeToken: {
      symbol: "AVAX",
      name: "Avalanche",
      decimals: 18,
      address: NATIVE_TOKEN_ADDRESS,
      chainId: "avalanche",
      coingeckoId: "avalanche-2",
    },
    rpcUrl: "https://api.avax.network/ext/bc/C/rpc",
    explorerUrl: "https://snowtrace.io",
  },
  {
    id: "bsc",
    name: "BNB Smart Chain",
    ecosystem: "evm",
    nativeChainId: 56,
    nativeToken: {
      symbol: "BNB",
      name: "BNB",
      decimals: 18,
      address: NATIVE_TOKEN_ADDRESS,
      chainId: "bsc",
      coingeckoId: "binancecoin",
    },
    rpcUrl: "https://bsc-dataseed.binance.org",
    explorerUrl: "https://bscscan.com",
  },
];

/** Map our chain IDs to numeric EVM chain IDs */
export const CHAIN_ID_MAP: Record<string, number> = {};
for (const chain of EVM_CHAINS) {
  CHAIN_ID_MAP[chain.id] = chain.nativeChainId as number;
}
