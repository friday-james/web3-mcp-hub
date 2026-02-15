import {
  createPublicClient,
  http,
  getAddress,
  isAddress,
  formatUnits,
  erc20Abi,
  type PublicClient,
  type HttpTransport,
  type Chain,
} from "viem";
import type {
  ChainAdapter,
  ChainEcosystem,
  ChainInfo,
  TokenBalance,
  TokenInfo,
} from "../../core/types.js";
import { formatTokenAmount } from "../../core/utils.js";
import { NATIVE_TOKEN_ADDRESS, EVM_CHAINS } from "./chains.js";

/** Well-known EVM tokens by symbol per chain for quick resolution */
const KNOWN_TOKENS: Record<string, Record<string, TokenInfo>> = {
  ethereum: {
    USDC: { symbol: "USDC", name: "USD Coin", decimals: 6, address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", chainId: "ethereum", coingeckoId: "usd-coin" },
    USDT: { symbol: "USDT", name: "Tether USD", decimals: 6, address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", chainId: "ethereum", coingeckoId: "tether" },
    WETH: { symbol: "WETH", name: "Wrapped Ether", decimals: 18, address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", chainId: "ethereum", coingeckoId: "weth" },
    DAI: { symbol: "DAI", name: "Dai", decimals: 18, address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", chainId: "ethereum", coingeckoId: "dai" },
    WBTC: { symbol: "WBTC", name: "Wrapped BTC", decimals: 8, address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", chainId: "ethereum", coingeckoId: "wrapped-bitcoin" },
    LINK: { symbol: "LINK", name: "Chainlink", decimals: 18, address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", chainId: "ethereum", coingeckoId: "chainlink" },
    UNI: { symbol: "UNI", name: "Uniswap", decimals: 18, address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", chainId: "ethereum", coingeckoId: "uniswap" },
  },
  base: {
    USDC: { symbol: "USDC", name: "USD Coin", decimals: 6, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", chainId: "base", coingeckoId: "usd-coin" },
    WETH: { symbol: "WETH", name: "Wrapped Ether", decimals: 18, address: "0x4200000000000000000000000000000000000006", chainId: "base", coingeckoId: "weth" },
    DAI: { symbol: "DAI", name: "Dai", decimals: 18, address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", chainId: "base", coingeckoId: "dai" },
  },
  arbitrum: {
    USDC: { symbol: "USDC", name: "USD Coin", decimals: 6, address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", chainId: "arbitrum", coingeckoId: "usd-coin" },
    USDT: { symbol: "USDT", name: "Tether USD", decimals: 6, address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", chainId: "arbitrum", coingeckoId: "tether" },
    WETH: { symbol: "WETH", name: "Wrapped Ether", decimals: 18, address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", chainId: "arbitrum", coingeckoId: "weth" },
    ARB: { symbol: "ARB", name: "Arbitrum", decimals: 18, address: "0x912CE59144191C1204E64559FE8253a0e49E6548", chainId: "arbitrum", coingeckoId: "arbitrum" },
  },
  polygon: {
    USDC: { symbol: "USDC", name: "USD Coin", decimals: 6, address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", chainId: "polygon", coingeckoId: "usd-coin" },
    USDT: { symbol: "USDT", name: "Tether USD", decimals: 6, address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", chainId: "polygon", coingeckoId: "tether" },
    WMATIC: { symbol: "WMATIC", name: "Wrapped Matic", decimals: 18, address: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", chainId: "polygon", coingeckoId: "wmatic" },
  },
};

export class EvmChainAdapter implements ChainAdapter {
  readonly ecosystem: ChainEcosystem = "evm";
  private clients = new Map<string, PublicClient<HttpTransport, Chain | undefined>>();

  constructor(
    private chains: ChainInfo[],
    rpcUrls: Record<string, string>
  ) {
    for (const chain of chains) {
      const rpcUrl = rpcUrls[chain.id] || chain.rpcUrl;
      const client = createPublicClient({ transport: http(rpcUrl) });
      this.clients.set(chain.id, client);
    }
  }

  getSupportedChains(): ChainInfo[] {
    return this.chains;
  }

  getChain(chainId: string): ChainInfo | undefined {
    return this.chains.find((c) => c.id === chainId);
  }

  isValidAddress(_chainId: string, address: string): boolean {
    return isAddress(address);
  }

  private getClient(chainId: string) {
    const client = this.clients.get(chainId);
    if (!client) throw new Error(`No client for chain "${chainId}"`);
    return client;
  }

  private getChainOrThrow(chainId: string): ChainInfo {
    const chain = this.getChain(chainId);
    if (!chain) throw new Error(`Chain "${chainId}" not supported`);
    return chain;
  }

  async getNativeBalance(
    chainId: string,
    address: string
  ): Promise<TokenBalance> {
    const client = this.getClient(chainId);
    const chain = this.getChainOrThrow(chainId);
    const balance = await client.getBalance({
      address: getAddress(address),
    });
    return {
      token: chain.nativeToken,
      balanceRaw: balance.toString(),
      balanceFormatted: formatUnits(balance, chain.nativeToken.decimals),
    };
  }

  async getTokenBalance(
    chainId: string,
    address: string,
    tokenAddress: string
  ): Promise<TokenBalance> {
    // If native token, delegate
    if (
      tokenAddress.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase()
    ) {
      return this.getNativeBalance(chainId, address);
    }

    const client = this.getClient(chainId);
    const checksumToken = getAddress(tokenAddress);
    const checksumAddr = getAddress(address);

    const results = await client.multicall({
      contracts: [
        {
          address: checksumToken,
          abi: erc20Abi,
          functionName: "symbol",
        },
        {
          address: checksumToken,
          abi: erc20Abi,
          functionName: "name",
        },
        {
          address: checksumToken,
          abi: erc20Abi,
          functionName: "decimals",
        },
        {
          address: checksumToken,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [checksumAddr],
        },
      ],
    });

    const symbol = results[0].result as string;
    const name = results[1].result as string;
    const decimals = results[2].result as number;
    const balance = results[3].result as bigint;

    const token: TokenInfo = {
      symbol,
      name,
      decimals,
      address: checksumToken,
      chainId,
    };

    return {
      token,
      balanceRaw: balance.toString(),
      balanceFormatted: formatTokenAmount(balance.toString(), decimals),
    };
  }

  async getTokenBalances(
    chainId: string,
    address: string,
    tokenAddresses: string[]
  ): Promise<TokenBalance[]> {
    const results = await Promise.all(
      tokenAddresses.map((t) => this.getTokenBalance(chainId, address, t))
    );
    return results;
  }

  async resolveToken(
    chainId: string,
    symbolOrAddress: string
  ): Promise<TokenInfo | undefined> {
    // Check if it's the native token
    const chain = this.getChainOrThrow(chainId);
    if (
      symbolOrAddress.toUpperCase() === chain.nativeToken.symbol ||
      symbolOrAddress.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase()
    ) {
      return chain.nativeToken;
    }

    // Check known tokens by symbol
    const knownForChain = KNOWN_TOKENS[chainId];
    if (knownForChain) {
      const bySymbol = knownForChain[symbolOrAddress.toUpperCase()];
      if (bySymbol) return bySymbol;
    }

    // If it's a valid address, read metadata on-chain
    if (isAddress(symbolOrAddress)) {
      const client = this.getClient(chainId);
      const addr = getAddress(symbolOrAddress);
      try {
        const results = await client.multicall({
          contracts: [
            { address: addr, abi: erc20Abi, functionName: "symbol" },
            { address: addr, abi: erc20Abi, functionName: "name" },
            { address: addr, abi: erc20Abi, functionName: "decimals" },
          ],
        });
        return {
          symbol: results[0].result as string,
          name: results[1].result as string,
          decimals: results[2].result as number,
          address: addr,
          chainId,
        };
      } catch {
        return undefined;
      }
    }

    return undefined;
  }
}
