export interface CometMarket {
  comet: `0x${string}`;
  baseToken: string;
  baseTokenAddress: `0x${string}`;
  baseTokenDecimals: number;
  baseTokenCoingeckoId: string;
}

export const COMPOUND_V3_MARKETS: Record<string, CometMarket> = {
  ethereum: {
    comet: "0xc3d688B66703497DAA19211EEdff47f25384cdc3",
    baseToken: "USDC",
    baseTokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    baseTokenDecimals: 6,
    baseTokenCoingeckoId: "usd-coin",
  },
  base: {
    comet: "0xb125E6687d4313864e53df431d5425969c15Eb2F",
    baseToken: "USDC",
    baseTokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    baseTokenDecimals: 6,
    baseTokenCoingeckoId: "usd-coin",
  },
  arbitrum: {
    comet: "0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA",
    baseToken: "USDC",
    baseTokenAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    baseTokenDecimals: 6,
    baseTokenCoingeckoId: "usd-coin",
  },
  polygon: {
    comet: "0xF25212E676D1F7F89Cd72fFEe66158f541246445",
    baseToken: "USDC",
    baseTokenAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    baseTokenDecimals: 6,
    baseTokenCoingeckoId: "usd-coin",
  },
  optimism: {
    comet: "0x2e44e174f7D53F0212823acC11C01A11d58c5bCB",
    baseToken: "USDC",
    baseTokenAddress: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    baseTokenDecimals: 6,
    baseTokenCoingeckoId: "usd-coin",
  },
};

export function getSupportedCompoundV3Chains(): string[] {
  return Object.keys(COMPOUND_V3_MARKETS);
}
