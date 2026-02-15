import type { ChainInfo } from "../../core/types.js";

export const COSMOS_CHAINS: ChainInfo[] = [
  {
    id: "osmosis-1",
    name: "Osmosis",
    ecosystem: "cosmos",
    nativeChainId: "osmosis-1",
    nativeToken: {
      symbol: "OSMO",
      name: "Osmosis",
      decimals: 6,
      address: "uosmo",
      chainId: "osmosis-1",
      coingeckoId: "osmosis",
    },
    rpcUrl: "https://rpc.osmosis.zone",
    explorerUrl: "https://www.mintscan.io/osmosis",
  },
  {
    id: "cosmoshub-4",
    name: "Cosmos Hub",
    ecosystem: "cosmos",
    nativeChainId: "cosmoshub-4",
    nativeToken: {
      symbol: "ATOM",
      name: "Cosmos Hub",
      decimals: 6,
      address: "uatom",
      chainId: "cosmoshub-4",
      coingeckoId: "cosmos",
    },
    rpcUrl: "https://rpc.cosmos.network",
    explorerUrl: "https://www.mintscan.io/cosmos",
  },
];
