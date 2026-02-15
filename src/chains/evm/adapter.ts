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
import { KNOWN_TOKENS } from "./known-tokens.js";

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
