import { StargateClient } from "@cosmjs/stargate";
import { fromBech32 } from "@cosmjs/encoding";
import type {
  ChainAdapter,
  ChainEcosystem,
  ChainInfo,
  TokenBalance,
  TokenInfo,
} from "../../core/types.js";
import { formatTokenAmount } from "../../core/utils.js";
import { COSMOS_CHAINS } from "./chains.js";

/** Well-known Cosmos denoms for quick resolution */
const KNOWN_TOKENS: Record<string, Record<string, TokenInfo>> = {
  "osmosis-1": {
    OSMO: { symbol: "OSMO", name: "Osmosis", decimals: 6, address: "uosmo", chainId: "osmosis-1", coingeckoId: "osmosis" },
    ATOM: {
      symbol: "ATOM", name: "Cosmos Hub", decimals: 6,
      address: "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
      chainId: "osmosis-1", coingeckoId: "cosmos",
    },
    USDC: {
      symbol: "USDC", name: "USD Coin", decimals: 6,
      address: "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75085FA758DC7A5C",
      chainId: "osmosis-1", coingeckoId: "usd-coin",
    },
  },
  "cosmoshub-4": {
    ATOM: { symbol: "ATOM", name: "Cosmos Hub", decimals: 6, address: "uatom", chainId: "cosmoshub-4", coingeckoId: "cosmos" },
  },
};

export class CosmosChainAdapter implements ChainAdapter {
  readonly ecosystem: ChainEcosystem = "cosmos";
  private clients = new Map<string, StargateClient>();

  constructor(
    private chains: ChainInfo[],
    private rpcUrls: Record<string, string>
  ) {}

  getSupportedChains(): ChainInfo[] {
    return this.chains;
  }

  getChain(chainId: string): ChainInfo | undefined {
    return this.chains.find((c) => c.id === chainId);
  }

  isValidAddress(_chainId: string, address: string): boolean {
    try {
      const { prefix } = fromBech32(address);
      return prefix.length > 0;
    } catch {
      return false;
    }
  }

  private async getClient(chainId: string): Promise<StargateClient> {
    if (!this.clients.has(chainId)) {
      const chain = this.getChainOrThrow(chainId);
      const rpcUrl = this.rpcUrls[chainId] || chain.rpcUrl;
      const client = await StargateClient.connect(rpcUrl);
      this.clients.set(chainId, client);
    }
    return this.clients.get(chainId)!;
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
    const client = await this.getClient(chainId);
    const chain = this.getChainOrThrow(chainId);
    const balance = await client.getBalance(
      address,
      chain.nativeToken.address
    );
    return {
      token: chain.nativeToken,
      balanceRaw: balance.amount,
      balanceFormatted: formatTokenAmount(
        balance.amount,
        chain.nativeToken.decimals
      ),
    };
  }

  async getTokenBalance(
    chainId: string,
    address: string,
    denom: string
  ): Promise<TokenBalance> {
    const chain = this.getChainOrThrow(chainId);

    // If native denom, delegate
    if (denom === chain.nativeToken.address) {
      return this.getNativeBalance(chainId, address);
    }

    const client = await this.getClient(chainId);
    const balance = await client.getBalance(address, denom);

    // Try to resolve token metadata
    const token = await this.resolveToken(chainId, denom);
    const tokenInfo: TokenInfo = token || {
      symbol: denom.length > 10 ? `${denom.slice(0, 8)}...` : denom,
      name: denom,
      decimals: 6, // Default for most Cosmos tokens
      address: denom,
      chainId,
    };

    return {
      token: tokenInfo,
      balanceRaw: balance.amount,
      balanceFormatted: formatTokenAmount(
        balance.amount,
        tokenInfo.decimals
      ),
    };
  }

  async getTokenBalances(
    chainId: string,
    address: string,
    denoms: string[]
  ): Promise<TokenBalance[]> {
    return Promise.all(
      denoms.map((d) => this.getTokenBalance(chainId, address, d))
    );
  }

  async resolveToken(
    chainId: string,
    symbolOrDenom: string
  ): Promise<TokenInfo | undefined> {
    const chain = this.getChainOrThrow(chainId);

    // Check native
    if (
      symbolOrDenom.toUpperCase() === chain.nativeToken.symbol ||
      symbolOrDenom === chain.nativeToken.address
    ) {
      return chain.nativeToken;
    }

    // Check known tokens by symbol
    const knownForChain = KNOWN_TOKENS[chainId];
    if (knownForChain) {
      const bySymbol = knownForChain[symbolOrDenom.toUpperCase()];
      if (bySymbol) return bySymbol;

      // Check by denom address
      for (const token of Object.values(knownForChain)) {
        if (token.address === symbolOrDenom) return token;
      }
    }

    return undefined;
  }
}
