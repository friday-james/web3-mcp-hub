import { z } from "zod";
import {
  createPublicClient,
  http,
  decodeFunctionResult,
  encodeFunctionData,
  parseAbi,
  getAddress,
  formatEther,
  formatUnits,
} from "viem";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";
import { ChainIdSchema, AddressSchema } from "../../tools/schemas.js";

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function errorResult(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }], isError: true };
}

export class ContractReaderPlugin implements DefiPlugin {
  readonly name = "contract-reader";
  readonly description =
    "Generic smart contract reader: call any view/pure function on any contract";
  readonly version = "1.0.0";

  async initialize(_ctx: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [this.readContractTool(), this.multicallTool(), this.contractInfoTool()];
  }

  private readContractTool(): ToolDefinition {
    return {
      name: "defi_read_contract",
      description:
        'Call any view/pure function on a smart contract. Provide the function signature in human-readable form (e.g. "function balanceOf(address) view returns (uint256)") and arguments as a JSON array.',
      inputSchema: z.object({
        chainId: ChainIdSchema,
        contractAddress: AddressSchema.describe("Contract address to call"),
        functionSignature: z
          .string()
          .describe(
            'Human-readable function signature, e.g. "function totalSupply() view returns (uint256)" or "function balanceOf(address owner) view returns (uint256)"'
          ),
        args: z
          .array(z.string())
          .optional()
          .describe("Function arguments as strings (addresses, numbers, etc.)"),
      }),
      handler: async (
        input: unknown,
        context: PluginContext
      ): Promise<ToolResult> => {
        try {
          const { chainId, contractAddress, functionSignature, args = [] } =
            input as {
              chainId: string;
              contractAddress: string;
              functionSignature: string;
              args?: string[];
            };

          const adapter = context.getChainAdapterForChain(chainId);
          const chain = adapter.getChain(chainId);
          if (!chain || chain.ecosystem !== "evm") {
            return errorResult("Contract reads only supported on EVM chains");
          }

          const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
          const client = createPublicClient({ transport: http(rpcUrl) });

          const abi = parseAbi([functionSignature]);
          const fnName = functionSignature
            .replace(/^function\s+/, "")
            .split("(")[0]
            .trim();

          // Parse args - convert numeric strings to BigInt where needed
          const parsedArgs = args.map((a) => {
            if (a.startsWith("0x")) return a;
            if (/^\d+$/.test(a)) return BigInt(a);
            return a;
          });

          const result: unknown = await client.readContract({
            address: getAddress(contractAddress),
            abi,
            functionName: fnName,
            args: parsedArgs.length > 0 ? parsedArgs : undefined,
          });

          // Format result
          const formatted =
            typeof result === "bigint"
              ? { raw: result.toString(), formatted: formatEther(result) }
              : result;

          return jsonResult({
            chain: chainId,
            contract: contractAddress,
            function: fnName,
            result: formatted,
          });
        } catch (e: any) {
          return errorResult(`Contract read failed: ${e.message}`);
        }
      },
    };
  }

  private multicallTool(): ToolDefinition {
    return {
      name: "defi_multicall",
      description:
        "Batch multiple contract read calls into a single RPC request. More efficient than making individual calls. Each call needs a contract address, function signature, and optional args.",
      inputSchema: z.object({
        chainId: ChainIdSchema,
        calls: z
          .array(
            z.object({
              contractAddress: z.string().describe("Contract address"),
              functionSignature: z
                .string()
                .describe("Human-readable function signature"),
              args: z.array(z.string()).optional().describe("Function arguments"),
            })
          )
          .min(1)
          .max(50)
          .describe("Array of contract calls to batch"),
      }),
      handler: async (
        input: unknown,
        context: PluginContext
      ): Promise<ToolResult> => {
        try {
          const { chainId, calls } = input as {
            chainId: string;
            calls: Array<{
              contractAddress: string;
              functionSignature: string;
              args?: string[];
            }>;
          };

          const adapter = context.getChainAdapterForChain(chainId);
          const chain = adapter.getChain(chainId);
          if (!chain || chain.ecosystem !== "evm") {
            return errorResult("Multicall only supported on EVM chains");
          }

          const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
          const client = createPublicClient({ transport: http(rpcUrl) });

          const multicallContracts = calls.map((call) => {
            const abi = parseAbi([call.functionSignature]);
            const fnName = call.functionSignature
              .replace(/^function\s+/, "")
              .split("(")[0]
              .trim();

            const parsedArgs = (call.args || []).map((a) => {
              if (a.startsWith("0x")) return a;
              if (/^\d+$/.test(a)) return BigInt(a);
              return a;
            });

            return {
              address: getAddress(call.contractAddress) as `0x${string}`,
              abi,
              functionName: fnName,
              args: parsedArgs.length > 0 ? parsedArgs : undefined,
            };
          });

          const results = await client.multicall({
            contracts: multicallContracts as any,
          });

          const formatted = results.map((r: any, i: number) => ({
            call: `${calls[i].contractAddress}.${calls[i].functionSignature.replace(/^function\s+/, "").split("(")[0]}`,
            status: r.status,
            result:
              r.status === "success"
                ? typeof r.result === "bigint"
                  ? r.result.toString()
                  : r.result
                : r.error?.message || "failed",
          }));

          return jsonResult({ chain: chainId, callCount: calls.length, results: formatted });
        } catch (e: any) {
          return errorResult(`Multicall failed: ${e.message}`);
        }
      },
    };
  }

  private contractInfoTool(): ToolDefinition {
    return {
      name: "defi_contract_info",
      description:
        "Get basic information about a smart contract: bytecode size, nonce (if EOA), and balance. Useful to check if an address is a contract or an EOA.",
      inputSchema: z.object({
        chainId: ChainIdSchema,
        address: AddressSchema.describe("Address to inspect"),
      }),
      handler: async (
        input: unknown,
        context: PluginContext
      ): Promise<ToolResult> => {
        try {
          const { chainId, address } = input as {
            chainId: string;
            address: string;
          };

          const adapter = context.getChainAdapterForChain(chainId);
          const chain = adapter.getChain(chainId);
          if (!chain || chain.ecosystem !== "evm") {
            return errorResult("Only supported on EVM chains");
          }

          const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
          const client = createPublicClient({ transport: http(rpcUrl) });

          const addr = getAddress(address);
          const [code, balance, nonce] = await Promise.all([
            client.getCode({ address: addr }),
            client.getBalance({ address: addr }),
            client.getTransactionCount({ address: addr }),
          ]);

          const isContract = !!code && code !== "0x";

          return jsonResult({
            chain: chainId,
            address: addr,
            isContract,
            bytecodeSize: isContract ? `${(code!.length - 2) / 2} bytes` : "0 bytes",
            balance: `${formatEther(balance)} ${chain.nativeToken.symbol}`,
            nonce,
          });
        } catch (e: any) {
          return errorResult(`Failed to get contract info: ${e.message}`);
        }
      },
    };
  }
}
