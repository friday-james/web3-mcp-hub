import { z } from "zod";
import { createPublicClient, http, getAddress, formatUnits } from "viem";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";
import { ChainIdSchema } from "../../tools/schemas.js";

// Chainlink price feed addresses on Ethereum mainnet
const PRICE_FEEDS: Record<string, Record<string, { address: string; decimals: number }>> = {
  ethereum: {
    "ETH/USD": { address: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419", decimals: 8 },
    "BTC/USD": { address: "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c", decimals: 8 },
    "LINK/USD": { address: "0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c", decimals: 8 },
    "AAVE/USD": { address: "0x547a514d5e3769680Ce22B2361c10Ea13619e8a9", decimals: 8 },
    "UNI/USD": { address: "0x553303d460EE0afB37EdFf9bE42922D8FF63220e", decimals: 8 },
    "COMP/USD": { address: "0xdbd020CAeF83eFd542f4De03e3cF0C28A4428bd5", decimals: 8 },
    "MKR/USD": { address: "0xec1D1B3b0443256cc3860e24a46F108e699484Aa", decimals: 8 },
    "SNX/USD": { address: "0xDC3EA94CD0AC27d9A86C180091e7f78C683d3699", decimals: 8 },
    "USDC/USD": { address: "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6", decimals: 8 },
    "USDT/USD": { address: "0x3E7d1eAB13ad0104d2750B8863b489D65364e32D", decimals: 8 },
    "DAI/USD": { address: "0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9", decimals: 8 },
    "SOL/USD": { address: "0x4ffC43a60e009B551865A93d232E33Fce9f01507", decimals: 8 },
    "MATIC/USD": { address: "0x7bAC85A8a13A4BcD8abb3eB7d6b4d632c5a57676", decimals: 8 },
    "AVAX/USD": { address: "0xFF3EEb22B5E3dE6e705b44749C2559d704923FD7", decimals: 8 },
    "ARB/USD": { address: "0x31697852a68433DbCc2Ff9bA924722580E9730ca", decimals: 8 },
    "OP/USD": { address: "0x0D276FC14719f9292D5C1eA2198673d1f4269246", decimals: 8 },
  },
  arbitrum: {
    "ETH/USD": { address: "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612", decimals: 8 },
    "BTC/USD": { address: "0x6ce185860a4963106506C203335A2910413708e9", decimals: 8 },
    "ARB/USD": { address: "0xb2A824043730FE05F3DA2efaFa1CBbe83fa548D6", decimals: 8 },
    "LINK/USD": { address: "0x86E53CF1B870786351Da77A57575e79CB55812CB", decimals: 8 },
    "USDC/USD": { address: "0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3", decimals: 8 },
  },
  base: {
    "ETH/USD": { address: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70", decimals: 8 },
    "cbETH/USD": { address: "0xd7818272B9e248357d13057AAb0B417aF31E817d", decimals: 8 },
    "USDC/USD": { address: "0x7e860098F58bBFC8648a4311b374B1D669a2bc6B", decimals: 8 },
  },
};

const AGGREGATOR_ABI = [
  {
    name: "latestRoundData",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  {
    name: "description",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "decimals",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

const SUPPORTED = Object.keys(PRICE_FEEDS);

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function errorResult(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }], isError: true };
}

export class ChainlinkPlugin implements DefiPlugin {
  readonly name = "chainlink";
  readonly description = "Chainlink oracle price feeds: get on-chain prices directly from Chainlink";
  readonly version = "1.0.0";

  async initialize(_ctx: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [this.priceFeedTool(), this.allPricesTool()];
  }

  private priceFeedTool(): ToolDefinition {
    return {
      name: "defi_chainlink_price",
      description: `Get the latest on-chain price from a Chainlink oracle price feed. More reliable than exchange prices for DeFi operations. Supported chains: ${SUPPORTED.join(", ")}.`,
      inputSchema: z.object({
        chainId: ChainIdSchema,
        pair: z.string().describe('Price pair (e.g. "ETH/USD", "BTC/USD", "LINK/USD")'),
      }),
      handler: async (input: unknown, context: PluginContext): Promise<ToolResult> => {
        try {
          const { chainId, pair } = input as { chainId: string; pair: string };
          const feeds = PRICE_FEEDS[chainId];
          if (!feeds) return errorResult(`Chainlink feeds not available on "${chainId}". Supported: ${SUPPORTED.join(", ")}`);

          const feed = feeds[pair.toUpperCase()];
          if (!feed) {
            const available = Object.keys(feeds).join(", ");
            return errorResult(`Price feed "${pair}" not available on ${chainId}. Available: ${available}`);
          }

          const adapter = context.getChainAdapterForChain(chainId);
          const chain = adapter.getChain(chainId);
          if (!chain) return errorResult(`Chain "${chainId}" not found`);

          const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
          const client = createPublicClient({ transport: http(rpcUrl) });

          const [roundData] = await Promise.all([
            client.readContract({
              address: getAddress(feed.address) as `0x${string}`,
              abi: AGGREGATOR_ABI,
              functionName: "latestRoundData",
            }),
          ]);

          const [roundId, answer, startedAt, updatedAt, answeredInRound] = roundData;
          const price = Number(formatUnits(answer, feed.decimals));
          const updatedTime = new Date(Number(updatedAt) * 1000).toISOString();
          const staleness = Math.floor(Date.now() / 1000) - Number(updatedAt);

          return jsonResult({
            pair: pair.toUpperCase(),
            chain: chainId,
            source: "Chainlink Oracle",
            price: `$${price.toFixed(feed.decimals > 4 ? 2 : 6)}`,
            feedAddress: feed.address,
            roundId: roundId.toString(),
            updatedAt: updatedTime,
            stalenessSeconds: staleness,
            warning: staleness > 3600 ? "Price data may be stale (>1hr since update)" : undefined,
          });
        } catch (e: any) {
          return errorResult(`Failed to read Chainlink feed: ${e.message}`);
        }
      },
    };
  }

  private allPricesTool(): ToolDefinition {
    return {
      name: "defi_chainlink_prices",
      description: `Get all available Chainlink oracle prices for a chain in a single call. Returns on-chain verified prices. Supported chains: ${SUPPORTED.join(", ")}.`,
      inputSchema: z.object({
        chainId: ChainIdSchema,
      }),
      handler: async (input: unknown, context: PluginContext): Promise<ToolResult> => {
        try {
          const { chainId } = input as { chainId: string };
          const feeds = PRICE_FEEDS[chainId];
          if (!feeds) return errorResult(`Chainlink feeds not available on "${chainId}". Supported: ${SUPPORTED.join(", ")}`);

          const adapter = context.getChainAdapterForChain(chainId);
          const chain = adapter.getChain(chainId);
          if (!chain) return errorResult(`Chain "${chainId}" not found`);

          const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
          const client = createPublicClient({ transport: http(rpcUrl) });

          const pairs = Object.entries(feeds);
          const results = await Promise.allSettled(
            pairs.map(async ([pair, feed]) => {
              const roundData = await client.readContract({
                address: getAddress(feed.address) as `0x${string}`,
                abi: AGGREGATOR_ABI,
                functionName: "latestRoundData",
              });
              const [, answer, , updatedAt] = roundData;
              return {
                pair,
                price: `$${Number(formatUnits(answer, feed.decimals)).toFixed(feed.decimals > 4 ? 2 : 6)}`,
                updatedAt: new Date(Number(updatedAt) * 1000).toISOString(),
                feedAddress: feed.address,
              };
            })
          );

          const prices = results
            .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
            .map((r) => r.value);

          return jsonResult({ chain: chainId, source: "Chainlink Oracles", count: prices.length, prices });
        } catch (e: any) {
          return errorResult(`Failed to fetch Chainlink prices: ${e.message}`);
        }
      },
    };
  }
}
