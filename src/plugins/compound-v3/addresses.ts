export interface CometMarket {
  comet: `0x${string}`;
  baseToken: string;
  baseTokenDecimals: number;
  baseTokenCoingeckoId: string;
}

export const COMPOUND_V3_MARKETS: Record<string, CometMarket> = {
  ethereum: {
    comet: "0xc3d688B66703497DAA19211EEdff47f25384cdc3",
    baseToken: "USDC",
    baseTokenDecimals: 6,
    baseTokenCoingeckoId: "usd-coin",
  },
  base: {
    comet: "0xb125E6687d4313864e53df431d5425969c15Eb2F",
    baseToken: "USDC",
    baseTokenDecimals: 6,
    baseTokenCoingeckoId: "usd-coin",
  },
  arbitrum: {
    comet: "0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA",
    baseToken: "USDC",
    baseTokenDecimals: 6,
    baseTokenCoingeckoId: "usd-coin",
  },
  polygon: {
    comet: "0xF25212E676D1F7F89Cd72fFEe66158f541246445",
    baseToken: "USDC",
    baseTokenDecimals: 6,
    baseTokenCoingeckoId: "usd-coin",
  },
  optimism: {
    comet: "0x2e44e174f7D53F0212823acC11C01A11d58c5bCB",
    baseToken: "USDC",
    baseTokenDecimals: 6,
    baseTokenCoingeckoId: "usd-coin",
  },
};

export function getSupportedCompoundV3Chains(): string[] {
  return Object.keys(COMPOUND_V3_MARKETS);
}
