import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAccount,
  getMint,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import type {
  ChainAdapter,
  ChainEcosystem,
  ChainInfo,
  TokenBalance,
  TokenInfo,
} from "../../core/types.js";
import { formatTokenAmount } from "../../core/utils.js";
import { NATIVE_SOL_MINT, SOLANA_CHAINS } from "./chains.js";

/** Well-known Solana tokens for quick resolution */
const KNOWN_TOKENS: Record<string, TokenInfo> = {
  USDC: { symbol: "USDC", name: "USD Coin", decimals: 6, address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", chainId: "solana-mainnet", coingeckoId: "usd-coin" },
  USDT: { symbol: "USDT", name: "Tether USD", decimals: 6, address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", chainId: "solana-mainnet", coingeckoId: "tether" },
  BONK: { symbol: "BONK", name: "Bonk", decimals: 5, address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", chainId: "solana-mainnet", coingeckoId: "bonk" },
  JUP: { symbol: "JUP", name: "Jupiter", decimals: 6, address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", chainId: "solana-mainnet", coingeckoId: "jupiter-exchange-solana" },
  RAY: { symbol: "RAY", name: "Raydium", decimals: 6, address: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", chainId: "solana-mainnet", coingeckoId: "raydium" },
  WSOL: { symbol: "WSOL", name: "Wrapped SOL", decimals: 9, address: NATIVE_SOL_MINT, chainId: "solana-mainnet", coingeckoId: "solana" },
};

export class SolanaChainAdapter implements ChainAdapter {
  readonly ecosystem: ChainEcosystem = "solana";
  private connections = new Map<string, Connection>();

  constructor(
    private chains: ChainInfo[],
    rpcUrls: Record<string, string>
  ) {
    for (const chain of chains) {
      const rpcUrl = rpcUrls[chain.id] || chain.rpcUrl;
      this.connections.set(chain.id, new Connection(rpcUrl, "confirmed"));
    }
  }

  getSupportedChains(): ChainInfo[] {
    return this.chains;
  }

  getChain(chainId: string): ChainInfo | undefined {
    return this.chains.find((c) => c.id === chainId);
  }

  isValidAddress(_chainId: string, address: string): boolean {
    try {
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  }

  private getConnection(chainId: string): Connection {
    const conn = this.connections.get(chainId);
    if (!conn) throw new Error(`No connection for chain "${chainId}"`);
    return conn;
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
    const connection = this.getConnection(chainId);
    const chain = this.getChainOrThrow(chainId);
    const pubkey = new PublicKey(address);
    const lamports = await connection.getBalance(pubkey);
    return {
      token: chain.nativeToken,
      balanceRaw: lamports.toString(),
      balanceFormatted: (lamports / LAMPORTS_PER_SOL).toString(),
    };
  }

  async getTokenBalance(
    chainId: string,
    address: string,
    mintAddress: string
  ): Promise<TokenBalance> {
    // Native SOL
    if (mintAddress === NATIVE_SOL_MINT) {
      return this.getNativeBalance(chainId, address);
    }

    const connection = this.getConnection(chainId);
    const ownerPubkey = new PublicKey(address);
    const mintPubkey = new PublicKey(mintAddress);

    try {
      const ata = await getAssociatedTokenAddress(mintPubkey, ownerPubkey);
      const [account, mint] = await Promise.all([
        getAccount(connection, ata),
        getMint(connection, mintPubkey),
      ]);

      const token: TokenInfo = {
        symbol: mintAddress.slice(0, 6),
        name: mintAddress.slice(0, 6),
        decimals: mint.decimals,
        address: mintAddress,
        chainId,
      };

      // Try to find known metadata
      for (const known of Object.values(KNOWN_TOKENS)) {
        if (known.address === mintAddress) {
          token.symbol = known.symbol;
          token.name = known.name;
          token.coingeckoId = known.coingeckoId;
          break;
        }
      }

      return {
        token,
        balanceRaw: account.amount.toString(),
        balanceFormatted: formatTokenAmount(
          account.amount.toString(),
          mint.decimals
        ),
      };
    } catch {
      // Account doesn't exist = zero balance
      const mint = await getMint(connection, mintPubkey);
      const token: TokenInfo = {
        symbol: mintAddress.slice(0, 6),
        name: mintAddress.slice(0, 6),
        decimals: mint.decimals,
        address: mintAddress,
        chainId,
      };
      return {
        token,
        balanceRaw: "0",
        balanceFormatted: "0",
      };
    }
  }

  async getTokenBalances(
    chainId: string,
    address: string,
    tokenAddresses: string[]
  ): Promise<TokenBalance[]> {
    return Promise.all(
      tokenAddresses.map((t) => this.getTokenBalance(chainId, address, t))
    );
  }

  async resolveToken(
    chainId: string,
    symbolOrAddress: string
  ): Promise<TokenInfo | undefined> {
    const chain = this.getChainOrThrow(chainId);

    // Check native SOL
    if (symbolOrAddress.toUpperCase() === "SOL") {
      return chain.nativeToken;
    }

    // Check known tokens
    const known = KNOWN_TOKENS[symbolOrAddress.toUpperCase()];
    if (known) return known;

    // Check if it's a valid mint address
    try {
      const pubkey = new PublicKey(symbolOrAddress);
      const connection = this.getConnection(chainId);
      const mint = await getMint(connection, pubkey);
      // Look up in known tokens by address
      for (const t of Object.values(KNOWN_TOKENS)) {
        if (t.address === symbolOrAddress) return t;
      }
      return {
        symbol: symbolOrAddress.slice(0, 6),
        name: symbolOrAddress.slice(0, 6),
        decimals: mint.decimals,
        address: symbolOrAddress,
        chainId,
      };
    } catch {
      return undefined;
    }
  }
}
