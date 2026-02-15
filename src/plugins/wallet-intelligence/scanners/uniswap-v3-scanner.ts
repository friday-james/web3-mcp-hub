import {
  createPublicClient,
  http,
  getAddress,
  erc20Abi,
} from "viem";
import type { ProtocolScanner, ProtocolPosition, PositionAsset } from "../../../core/scanner-types.js";
import type { PluginContext } from "../../../core/types.js";
import { POSITION_MANAGER_ABI, POSITION_MANAGER_ADDRESSES } from "./uniswap-v3-abi.js";

export class UniswapV3LPScanner implements ProtocolScanner {
  readonly protocolName = "Uniswap V3";
  readonly supportedChains = Object.keys(POSITION_MANAGER_ADDRESSES);

  async scanPositions(
    chainId: string,
    walletAddress: string,
    context: PluginContext
  ): Promise<ProtocolPosition[]> {
    const pmAddress = POSITION_MANAGER_ADDRESSES[chainId];
    if (!pmAddress) return [];

    const chain = context.getChainAdapterForChain(chainId).getChain(chainId);
    if (!chain) return [];

    const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
    const client = createPublicClient({
      transport: http(rpcUrl, { batch: true }),
      batch: { multicall: true },
    });
    const user = getAddress(walletAddress);

    // Get number of LP NFTs
    const balance = (await client.readContract({
      address: pmAddress,
      abi: POSITION_MANAGER_ABI,
      functionName: "balanceOf",
      args: [user],
    })) as bigint;

    if (balance === 0n) return [];

    const count = Number(balance);
    // Cap at 20 positions to avoid excessive RPC calls
    const limit = Math.min(count, 20);

    // Get all token IDs
    const tokenIdResults = await client.multicall({
      contracts: Array.from({ length: limit }, (_, i) => ({
        address: pmAddress,
        abi: POSITION_MANAGER_ABI,
        functionName: "tokenOfOwnerByIndex" as const,
        args: [user, BigInt(i)],
      })),
    });

    const tokenIds = tokenIdResults
      .filter((r) => r.status === "success")
      .map((r) => r.result as bigint);

    if (tokenIds.length === 0) return [];

    // Get position details for each token ID
    const positionResults = await client.multicall({
      contracts: tokenIds.map((id) => ({
        address: pmAddress,
        abi: POSITION_MANAGER_ABI,
        functionName: "positions" as const,
        args: [id],
      })),
    });

    // Collect unique token addresses for metadata lookup
    const tokenAddressSet = new Set<string>();
    const validPositions: Array<{
      tokenId: bigint;
      token0: string;
      token1: string;
      fee: number;
      tickLower: number;
      tickUpper: number;
      liquidity: bigint;
      tokensOwed0: bigint;
      tokensOwed1: bigint;
    }> = [];

    for (let i = 0; i < positionResults.length; i++) {
      const r = positionResults[i];
      if (r.status !== "success") continue;
      const data = r.result as readonly [
        bigint, string, string, string, number, number, number,
        bigint, bigint, bigint, bigint, bigint
      ];

      const liquidity = data[7];
      // Skip closed positions (0 liquidity and no owed fees)
      if (liquidity === 0n && data[10] === 0n && data[11] === 0n) continue;

      const token0 = data[2] as string;
      const token1 = data[3] as string;
      tokenAddressSet.add(token0.toLowerCase());
      tokenAddressSet.add(token1.toLowerCase());

      validPositions.push({
        tokenId: tokenIds[i],
        token0,
        token1,
        fee: Number(data[4]),
        tickLower: Number(data[5]),
        tickUpper: Number(data[6]),
        liquidity,
        tokensOwed0: data[10] as bigint,
        tokensOwed1: data[11] as bigint,
      });
    }

    if (validPositions.length === 0) return [];

    // Batch fetch token symbols and decimals
    const uniqueTokens = [...tokenAddressSet];
    const metaResults = await client.multicall({
      contracts: uniqueTokens.flatMap((addr) => [
        {
          address: getAddress(addr) as `0x${string}`,
          abi: erc20Abi,
          functionName: "symbol" as const,
        },
        {
          address: getAddress(addr) as `0x${string}`,
          abi: erc20Abi,
          functionName: "decimals" as const,
        },
      ]),
    });

    const tokenMeta = new Map<string, { symbol: string; decimals: number }>();
    for (let i = 0; i < uniqueTokens.length; i++) {
      const symbol = metaResults[i * 2]?.result as string | undefined;
      const decimals = metaResults[i * 2 + 1]?.result as number | undefined;
      if (symbol && decimals !== undefined) {
        tokenMeta.set(uniqueTokens[i], { symbol, decimals });
      }
    }

    // Build position results
    const positions: ProtocolPosition[] = [];

    for (const pos of validPositions) {
      const meta0 = tokenMeta.get(pos.token0.toLowerCase());
      const meta1 = tokenMeta.get(pos.token1.toLowerCase());
      const sym0 = meta0?.symbol ?? "???";
      const sym1 = meta1?.symbol ?? "???";
      const feeTier = pos.fee / 10000; // e.g. 3000 → 0.3%

      const assets: PositionAsset[] = [
        {
          symbol: sym0,
          address: pos.token0,
          balance: pos.liquidity.toString(),
          balanceUsd: 0, // approximate — accurate valuation deferred to V2
        },
        {
          symbol: sym1,
          address: pos.token1,
          balance: pos.liquidity.toString(),
          balanceUsd: 0,
        },
      ];

      positions.push({
        protocol: "Uniswap V3",
        type: "lp",
        chainId,
        chainName: chain.name,
        assets,
        totalValueUsd: 0, // approximate — needs pool tick for accurate calc
        metadata: {
          tokenId: pos.tokenId.toString(),
          pair: `${sym0}/${sym1}`,
          feeTier: `${feeTier}%`,
          tickLower: pos.tickLower,
          tickUpper: pos.tickUpper,
          liquidity: pos.liquidity.toString(),
          hasUnclaimedFees:
            pos.tokensOwed0 > 0n || pos.tokensOwed1 > 0n,
        },
      });
    }

    return positions;
  }
}
