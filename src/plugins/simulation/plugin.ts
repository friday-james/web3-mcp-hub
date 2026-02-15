import { z } from "zod";
import {
  createPublicClient,
  http,
  getAddress,
  formatEther,
  formatGwei,
  decodeFunctionResult,
  parseEther,
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

export class SimulationPlugin implements DefiPlugin {
  readonly name = "simulation";
  readonly description =
    "Transaction simulation: dry-run any transaction to check if it will succeed before signing";
  readonly version = "1.0.0";

  async initialize(_ctx: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [this.simulateTool(), this.simulateBundleTool()];
  }

  private simulateTool(): ToolDefinition {
    return {
      name: "defi_simulate_tx",
      description:
        "Simulate a transaction without executing it. Returns whether it would succeed or revert, the gas it would use, and any return data. ALWAYS simulate before recommending a user sign a transaction.",
      inputSchema: z.object({
        chainId: ChainIdSchema,
        from: AddressSchema.describe("Sender address"),
        to: AddressSchema.describe("Target contract address"),
        data: z.string().optional().describe("Transaction calldata (hex-encoded)"),
        value: z.string().optional().describe('ETH value to send (e.g. "0.1")'),
      }),
      handler: async (
        input: unknown,
        context: PluginContext
      ): Promise<ToolResult> => {
        try {
          const { chainId, from, to, data, value } = input as {
            chainId: string;
            from: string;
            to: string;
            data?: string;
            value?: string;
          };

          const adapter = context.getChainAdapterForChain(chainId);
          const chain = adapter.getChain(chainId);
          if (!chain || chain.ecosystem !== "evm") {
            return errorResult("Simulation only supported on EVM chains");
          }

          const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
          const client = createPublicClient({ transport: http(rpcUrl) });

          const txRequest: any = {
            account: getAddress(from),
            to: getAddress(to),
          };
          if (data) txRequest.data = data as `0x${string}`;
          if (value) txRequest.value = parseEther(value);

          // Try to simulate via eth_call
          let callResult: string | undefined;
          let callError: string | undefined;
          let reverted = false;

          try {
            callResult = await client.call(txRequest) as any;
            if (typeof callResult === "object" && callResult !== null) {
              callResult = (callResult as any).data;
            }
          } catch (e: any) {
            reverted = true;
            callError = e.shortMessage || e.message || "Unknown revert reason";
            // Try to extract revert reason
            if (e.cause?.data) {
              callError = `Reverted with data: ${e.cause.data}`;
            }
          }

          // Estimate gas (may also fail if tx would revert)
          let gasEstimate: string | undefined;
          let gasCost: string | undefined;

          if (!reverted) {
            try {
              const gas = await client.estimateGas(txRequest);
              const gasPrice = await client.getGasPrice();
              gasEstimate = gas.toString();
              gasCost = `${formatEther(gas * gasPrice)} ${chain.nativeToken.symbol}`;
            } catch (e: any) {
              // Gas estimation can fail even if call succeeds
              gasEstimate = "estimation failed";
            }
          }

          // Check sender balance
          const balance = await client.getBalance({
            address: getAddress(from),
          });

          const requiredValue = value ? parseEther(value) : 0n;
          const hasEnoughBalance = balance >= requiredValue;

          return jsonResult({
            chain: chainId,
            simulation: {
              success: !reverted,
              wouldRevert: reverted,
              revertReason: callError || undefined,
              returnData: callResult || undefined,
            },
            gas: {
              estimated: gasEstimate,
              estimatedCost: gasCost,
            },
            sender: {
              address: from,
              balance: `${formatEther(balance)} ${chain.nativeToken.symbol}`,
              hasEnoughForValue: hasEnoughBalance,
              shortfall:
                !hasEnoughBalance && requiredValue > 0n
                  ? `${formatEther(requiredValue - balance)} ${chain.nativeToken.symbol}`
                  : undefined,
            },
            recommendation: reverted
              ? "DO NOT sign this transaction — it will revert and waste gas."
              : !hasEnoughBalance
                ? "Transaction may succeed but sender has insufficient balance for the value."
                : "Transaction simulation passed. Safe to sign.",
          });
        } catch (e: any) {
          return errorResult(`Simulation failed: ${e.message}`);
        }
      },
    };
  }

  private simulateBundleTool(): ToolDefinition {
    return {
      name: "defi_simulate_bundle",
      description:
        "Simulate a sequence of transactions in order (e.g. approve then swap). Checks if each step would succeed given the previous steps. Essential for multi-step DeFi operations.",
      inputSchema: z.object({
        chainId: ChainIdSchema,
        transactions: z
          .array(
            z.object({
              from: z.string().describe("Sender address"),
              to: z.string().describe("Target address"),
              data: z.string().optional().describe("Calldata (hex)"),
              value: z.string().optional().describe("ETH value"),
              label: z.string().optional().describe("Human-readable label for this step"),
            })
          )
          .min(1)
          .max(10)
          .describe("Ordered list of transactions to simulate"),
      }),
      handler: async (
        input: unknown,
        context: PluginContext
      ): Promise<ToolResult> => {
        try {
          const { chainId, transactions } = input as {
            chainId: string;
            transactions: Array<{
              from: string;
              to: string;
              data?: string;
              value?: string;
              label?: string;
            }>;
          };

          const adapter = context.getChainAdapterForChain(chainId);
          const chain = adapter.getChain(chainId);
          if (!chain || chain.ecosystem !== "evm") {
            return errorResult("Simulation only supported on EVM chains");
          }

          const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
          const client = createPublicClient({ transport: http(rpcUrl) });

          const results: Array<{
            step: number;
            label: string;
            success: boolean;
            error?: string;
            gasEstimate?: string;
          }> = [];

          let allPassed = true;

          for (let i = 0; i < transactions.length; i++) {
            const tx = transactions[i];
            const txRequest: any = {
              account: getAddress(tx.from),
              to: getAddress(tx.to),
            };
            if (tx.data) txRequest.data = tx.data as `0x${string}`;
            if (tx.value) txRequest.value = parseEther(tx.value);

            const stepResult: any = {
              step: i + 1,
              label: tx.label || `Transaction ${i + 1}`,
              success: false,
            };

            try {
              await client.call(txRequest);
              stepResult.success = true;

              try {
                const gas = await client.estimateGas(txRequest);
                stepResult.gasEstimate = gas.toString();
              } catch {}
            } catch (e: any) {
              stepResult.success = false;
              stepResult.error =
                e.shortMessage || e.message || "Unknown revert";
              allPassed = false;
            }

            results.push(stepResult);

            // If a step fails, remaining steps are unreliable
            if (!stepResult.success) {
              for (let j = i + 1; j < transactions.length; j++) {
                results.push({
                  step: j + 1,
                  label: transactions[j].label || `Transaction ${j + 1}`,
                  success: false,
                  error: `Skipped — step ${i + 1} failed`,
                });
              }
              break;
            }
          }

          return jsonResult({
            chain: chainId,
            bundleSuccess: allPassed,
            stepCount: transactions.length,
            results,
            recommendation: allPassed
              ? "All steps pass simulation. Safe to execute in order."
              : `Bundle would fail at step ${results.find((r) => !r.success)?.step}. Fix that step before proceeding.`,
          });
        } catch (e: any) {
          return errorResult(`Bundle simulation failed: ${e.message}`);
        }
      },
    };
  }
}
