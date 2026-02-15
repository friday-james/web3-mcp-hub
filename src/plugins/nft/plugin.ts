import { z } from "zod";
import { getAddress, encodeFunctionData } from "viem";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";
import { ChainIdSchema, AddressSchema } from "../../tools/schemas.js";

const ERC721_TRANSFER_ABI = [
  {
    name: "transferFrom",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function errorResult(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }], isError: true };
}

export class NftPlugin implements DefiPlugin {
  readonly name = "nft";
  readonly description = "NFT collection data and transfer transactions";
  readonly version = "1.0.0";

  async initialize(_ctx: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [this.collectionTool(), this.transferTxTool()];
  }

  private collectionTool(): ToolDefinition {
    return {
      name: "defi_nft_collection",
      description:
        "Get NFT collection info from CoinGecko: floor price, market cap, volume, and supply.",
      inputSchema: z.object({
        collectionId: z
          .string()
          .describe('CoinGecko NFT collection ID (e.g. "bored-ape-yacht-club", "cryptopunks", "pudgy-penguins")'),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { collectionId } = input as { collectionId: string };
          const res = await fetch(
            `https://api.coingecko.com/api/v3/nfts/${encodeURIComponent(collectionId)}`
          );
          if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
          const data = await res.json();

          return jsonResult({
            name: data.name,
            symbol: data.symbol,
            contractAddress: data.contract_address,
            chain: data.asset_platform_id,
            floorPrice: data.floor_price,
            marketCap: data.market_cap,
            volume24h: data.volume_24h,
            totalSupply: data.total_supply,
            numberOfUniqueAddresses: data.number_of_unique_addresses,
            floorPriceChange24h: data.floor_price_24h_percentage_change,
            description: data.description?.slice(0, 200),
          });
        } catch (e: any) {
          return errorResult(`Failed to fetch NFT collection: ${e.message}`);
        }
      },
    };
  }

  private transferTxTool(): ToolDefinition {
    return {
      name: "defi_nft_transfer_tx",
      description:
        "Build an unsigned ERC721 NFT transfer transaction.",
      inputSchema: z.object({
        chainId: ChainIdSchema,
        contractAddress: AddressSchema.describe("NFT contract address"),
        tokenId: z.string().describe("Token ID to transfer"),
        from: AddressSchema.describe("Current owner address"),
        to: AddressSchema.describe("Recipient address"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const { chainId, contractAddress, tokenId, from, to } = input as {
          chainId: string; contractAddress: string; tokenId: string;
          from: string; to: string;
        };

        const data = encodeFunctionData({
          abi: ERC721_TRANSFER_ABI,
          functionName: "transferFrom",
          args: [getAddress(from), getAddress(to), BigInt(tokenId)],
        });

        return jsonResult({
          chainId,
          ecosystem: "evm",
          raw: {
            to: getAddress(contractAddress),
            data,
            value: "0x0",
            from: getAddress(from),
          },
          description: `Transfer NFT #${tokenId} from ${from} to ${to}`,
        });
      },
    };
  }
}
