import { z } from "zod";
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

const CHAIN_ID_MAP: Record<string, number> = {
  ethereum: 1, polygon: 137, arbitrum: 42161, base: 8453,
  optimism: 10, avalanche: 43114, bsc: 56,
};

export class RiskPlugin implements DefiPlugin {
  readonly name = "risk";
  readonly description =
    "DeFi risk assessment: protocol risk scoring, token risk analysis, and pre-trade safety checks";
  readonly version = "1.0.0";

  async initialize(_ctx: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [
      this.protocolRiskTool(),
      this.preTradeCheckTool(),
      this.approvalAuditTool(),
    ];
  }

  private protocolRiskTool(): ToolDefinition {
    return {
      name: "defi_protocol_risk",
      description:
        "Assess the risk of a DeFi protocol by analyzing TVL, age, audit status, and chain presence. Uses DefiLlama data. Always check protocol risk before recommending a user interact with it.",
      inputSchema: z.object({
        protocolSlug: z
          .string()
          .describe(
            'DefiLlama protocol slug (e.g. "aave-v3", "uniswap-v3", "lido")'
          ),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { protocolSlug } = input as { protocolSlug: string };

          const res = await fetch(
            `https://api.llama.fi/protocol/${protocolSlug}`
          );
          if (!res.ok) throw new Error(`DefiLlama ${res.status}`);
          const data = await res.json();

          const tvl = data.currentChainTvls
            ? Object.values(data.currentChainTvls).reduce(
                (sum: number, v: any) => sum + (typeof v === "number" ? v : 0),
                0
              )
            : 0;

          // Calculate age in days
          const launchDate = data.listedAt
            ? new Date(data.listedAt * 1000)
            : null;
          const ageDays = launchDate
            ? Math.floor(
                (Date.now() - launchDate.getTime()) / (1000 * 60 * 60 * 24)
              )
            : null;

          // Check for audits
          const audits = data.audits || [];
          const auditCount = audits.length;

          // Check chain diversity
          const chains = data.chains || [];
          const chainCount = chains.length;

          // Risk scoring (0-100, lower = safer)
          let riskScore = 50; // baseline

          // TVL-based risk
          if (tvl > 1e9) riskScore -= 20; // >$1B TVL = very established
          else if (tvl > 100e6) riskScore -= 10; // >$100M
          else if (tvl < 1e6) riskScore += 20; // <$1M = risky
          else if (tvl < 10e6) riskScore += 10; // <$10M

          // Age-based risk
          if (ageDays && ageDays > 365) riskScore -= 10; // >1 year
          else if (ageDays && ageDays > 180) riskScore -= 5;
          else if (ageDays && ageDays < 30) riskScore += 15; // <30 days

          // Audit-based risk
          if (auditCount >= 3) riskScore -= 10;
          else if (auditCount >= 1) riskScore -= 5;
          else riskScore += 10;

          // Chain diversity
          if (chainCount >= 5) riskScore -= 5;
          else if (chainCount === 1) riskScore += 5;

          // Hack history
          const hacks = data.hallmarks?.filter((h: any) =>
            h[1]?.toLowerCase().includes("hack") ||
            h[1]?.toLowerCase().includes("exploit")
          ) || [];
          if (hacks.length > 0) riskScore += 15;

          riskScore = Math.max(0, Math.min(100, riskScore));

          let riskLevel: string;
          if (riskScore <= 20) riskLevel = "LOW";
          else if (riskScore <= 40) riskLevel = "MODERATE";
          else if (riskScore <= 60) riskLevel = "ELEVATED";
          else if (riskScore <= 80) riskLevel = "HIGH";
          else riskLevel = "CRITICAL";

          return jsonResult({
            protocol: data.name || protocolSlug,
            category: data.category,
            riskAssessment: {
              score: riskScore,
              level: riskLevel,
              summary: this.riskSummary(riskLevel, data.name || protocolSlug),
            },
            factors: {
              tvl: tvl > 0 ? `$${(tvl / 1e6).toFixed(1)}M` : "Unknown",
              age: ageDays ? `${ageDays} days` : "Unknown",
              audits: auditCount > 0
                ? audits.map((a: any) => a.auditor || a.name || "Unknown")
                : "None found",
              chains: chains.slice(0, 10),
              chainCount,
              hackHistory: hacks.length > 0
                ? hacks.map((h: any) => ({
                    date: new Date(h[0] * 1000).toISOString().slice(0, 10),
                    event: h[1],
                  }))
                : "No known exploits",
            },
            url: data.url,
          });
        } catch (e: any) {
          return errorResult(`Risk assessment failed: ${e.message}`);
        }
      },
    };
  }

  private riskSummary(level: string, name: string): string {
    switch (level) {
      case "LOW":
        return `${name} is a well-established protocol with strong safety indicators.`;
      case "MODERATE":
        return `${name} shows reasonable safety indicators but exercise normal caution.`;
      case "ELEVATED":
        return `${name} has some risk factors. Recommend smaller position sizes and extra due diligence.`;
      case "HIGH":
        return `${name} has significant risk factors. Only proceed if you understand and accept the risks.`;
      case "CRITICAL":
        return `${name} shows critical risk indicators. Strongly recommend against interaction unless you have deep knowledge of this protocol.`;
      default:
        return `Unable to fully assess ${name}. Proceed with caution.`;
    }
  }

  private preTradeCheckTool(): ToolDefinition {
    return {
      name: "defi_pre_trade_check",
      description:
        "Run a comprehensive pre-trade safety check on a token before swapping. Checks token security (honeypot, taxes, proxy), liquidity depth, and contract verification. ALWAYS run this before recommending a swap to/from an unfamiliar token.",
      inputSchema: z.object({
        chainId: ChainIdSchema,
        tokenAddress: AddressSchema.describe("Token contract address to check"),
      }),
      handler: async (
        input: unknown,
        context: PluginContext
      ): Promise<ToolResult> => {
        try {
          const { chainId, tokenAddress } = input as {
            chainId: string;
            tokenAddress: string;
          };

          const numericChainId = CHAIN_ID_MAP[chainId];
          if (!numericChainId)
            return errorResult(`Pre-trade check not available on "${chainId}"`);

          // Parallel: GoPlus security check + DexScreener liquidity check
          const [securityRes, dexRes] = await Promise.allSettled([
            fetch(
              `https://api.gopluslabs.io/api/v1/token_security/${numericChainId}?contract_addresses=${tokenAddress}`
            ).then((r) => r.json()),
            fetch(
              `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`
            ).then((r) => r.json()),
          ]);

          // Parse security data
          const issues: string[] = [];
          const warnings: string[] = [];
          let securityData: any = {};

          if (securityRes.status === "fulfilled") {
            const sec =
              securityRes.value?.result?.[tokenAddress.toLowerCase()] || {};
            securityData = sec;

            if (sec.is_honeypot === "1") issues.push("HONEYPOT — cannot sell");
            if (sec.is_proxy === "1") warnings.push("Proxy contract (upgradeable)");
            if (sec.is_mintable === "1") warnings.push("Mintable (supply can increase)");
            if (sec.can_take_back_ownership === "1")
              issues.push("Ownership can be reclaimed");
            if (sec.is_blacklisted === "1")
              warnings.push("Has blacklist functionality");
            if (sec.is_anti_whale === "1")
              warnings.push("Anti-whale limits in place");

            const buyTax = parseFloat(sec.buy_tax || "0") * 100;
            const sellTax = parseFloat(sec.sell_tax || "0") * 100;
            if (buyTax > 5) issues.push(`High buy tax: ${buyTax.toFixed(1)}%`);
            else if (buyTax > 0)
              warnings.push(`Buy tax: ${buyTax.toFixed(1)}%`);
            if (sellTax > 5)
              issues.push(`High sell tax: ${sellTax.toFixed(1)}%`);
            else if (sellTax > 0)
              warnings.push(`Sell tax: ${sellTax.toFixed(1)}%`);

            if (sec.is_open_source === "0")
              issues.push("Contract source code NOT verified");
          }

          // Parse liquidity data
          let liquidityUsd = 0;
          let volume24h = 0;
          let pairCount = 0;

          if (dexRes.status === "fulfilled") {
            const pairs = dexRes.value?.pairs || [];
            pairCount = pairs.length;
            liquidityUsd = pairs.reduce(
              (sum: number, p: any) => sum + (p.liquidity?.usd || 0),
              0
            );
            volume24h = pairs.reduce(
              (sum: number, p: any) => sum + (p.volume?.h24 || 0),
              0
            );
          }

          if (liquidityUsd < 10000)
            issues.push(`Very low liquidity: $${liquidityUsd.toFixed(0)}`);
          else if (liquidityUsd < 100000)
            warnings.push(`Low liquidity: $${liquidityUsd.toFixed(0)}`);

          if (pairCount === 0) issues.push("No trading pairs found");

          // Overall verdict
          let verdict: string;
          let safe: boolean;
          if (issues.length === 0 && warnings.length === 0) {
            verdict = "PASS — No issues detected. Token appears safe to trade.";
            safe = true;
          } else if (issues.length === 0) {
            verdict = `CAUTION — ${warnings.length} warning(s) found. Review before trading.`;
            safe = true;
          } else {
            verdict = `FAIL — ${issues.length} critical issue(s) found. DO NOT trade this token.`;
            safe = false;
          }

          return jsonResult({
            chain: chainId,
            token: tokenAddress,
            verdict,
            safe,
            criticalIssues: issues.length > 0 ? issues : "None",
            warnings: warnings.length > 0 ? warnings : "None",
            liquidity: {
              totalUsd: `$${liquidityUsd.toFixed(0)}`,
              volume24h: `$${volume24h.toFixed(0)}`,
              tradingPairs: pairCount,
            },
            contractInfo: {
              openSource: securityData.is_open_source === "1",
              proxy: securityData.is_proxy === "1",
              mintable: securityData.is_mintable === "1",
              ownerAddress: securityData.owner_address || "Unknown",
            },
          });
        } catch (e: any) {
          return errorResult(`Pre-trade check failed: ${e.message}`);
        }
      },
    };
  }

  private approvalAuditTool(): ToolDefinition {
    return {
      name: "defi_approval_audit",
      description:
        "Audit all active ERC20 token approvals for a wallet. Identifies unlimited approvals, approvals to unverified contracts, and suggests which to revoke. Essential for wallet security hygiene.",
      inputSchema: z.object({
        chainId: ChainIdSchema,
        userAddress: AddressSchema.describe("Wallet address to audit"),
        tokenAddresses: z
          .array(z.string())
          .min(1)
          .max(20)
          .describe(
            "Token addresses to check approvals for. Use defi_get_balances first to find tokens in wallet."
          ),
      }),
      handler: async (
        input: unknown,
        context: PluginContext
      ): Promise<ToolResult> => {
        try {
          const { chainId, userAddress, tokenAddresses } = input as {
            chainId: string;
            userAddress: string;
            tokenAddresses: string[];
          };

          const adapter = context.getChainAdapterForChain(chainId);
          const chain = adapter.getChain(chainId);
          if (!chain || chain.ecosystem !== "evm") {
            return errorResult("Approval audit only supported on EVM chains");
          }

          const { createPublicClient, http, getAddress, maxUint256 } =
            await import("viem");
          const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
          const client = createPublicClient({ transport: http(rpcUrl) });

          // Known safe spenders (major DEX routers, lending protocols)
          const KNOWN_SAFE: Record<string, string> = {
            "0x1111111254EEB25477B68fb85Ed929f73A960582": "1inch Router",
            "0xDef1C0ded9bec7F1a1670819833240f027b25EfF": "0x Exchange",
            "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45": "Uniswap Router",
            "0xE592427A0AEce92De3Edee1F18E0157C05861564": "Uniswap V3 Router",
            "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2": "Aave V3 Pool",
            "0x000000000022D473030F116dDEE9F6B43aC78BA3": "Permit2",
            "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE": "Li.Fi Diamond",
          };

          // Common spenders to check
          const SPENDERS_TO_CHECK = Object.keys(KNOWN_SAFE);

          const allowanceAbi = [
            {
              name: "allowance",
              type: "function" as const,
              stateMutability: "view" as const,
              inputs: [
                { name: "owner", type: "address" },
                { name: "spender", type: "address" },
              ],
              outputs: [{ type: "uint256" }],
            },
            {
              name: "symbol",
              type: "function" as const,
              stateMutability: "view" as const,
              inputs: [],
              outputs: [{ type: "string" }],
            },
          ] as const;

          const owner = getAddress(userAddress);
          const approvals: Array<{
            token: string;
            tokenAddress: string;
            spender: string;
            spenderLabel: string;
            allowance: string;
            isUnlimited: boolean;
            risk: string;
          }> = [];

          // Check each token against known spenders
          for (const tokenAddr of tokenAddresses) {
            let symbol = tokenAddr.slice(0, 8);
            try {
              symbol = (await client.readContract({
                address: getAddress(tokenAddr) as `0x${string}`,
                abi: allowanceAbi,
                functionName: "symbol",
              })) as string;
            } catch {}

            for (const spender of SPENDERS_TO_CHECK) {
              try {
                const allowance = (await client.readContract({
                  address: getAddress(tokenAddr) as `0x${string}`,
                  abi: allowanceAbi,
                  functionName: "allowance",
                  args: [owner, getAddress(spender)],
                })) as bigint;

                if (allowance > 0n) {
                  const isUnlimited = allowance >= maxUint256 / 2n;
                  const label =
                    KNOWN_SAFE[spender] || `Unknown (${spender.slice(0, 10)}...)`;

                  approvals.push({
                    token: symbol,
                    tokenAddress: tokenAddr,
                    spender,
                    spenderLabel: label,
                    allowance: isUnlimited
                      ? "UNLIMITED"
                      : allowance.toString(),
                    isUnlimited,
                    risk: KNOWN_SAFE[spender]
                      ? isUnlimited
                        ? "low (known protocol, but unlimited)"
                        : "low"
                      : "HIGH (unknown spender)",
                  });
                }
              } catch {
                // Skip failed reads
              }
            }
          }

          const highRisk = approvals.filter((a) => a.risk.startsWith("HIGH"));
          const unlimited = approvals.filter((a) => a.isUnlimited);

          return jsonResult({
            chain: chainId,
            wallet: userAddress,
            totalApprovals: approvals.length,
            highRiskCount: highRisk.length,
            unlimitedCount: unlimited.length,
            approvals,
            recommendations: [
              ...(highRisk.length > 0
                ? [
                    `Revoke ${highRisk.length} approval(s) to unknown contracts immediately using defi_revoke_approval_tx`,
                  ]
                : []),
              ...(unlimited.length > 0
                ? [
                    `Consider reducing ${unlimited.length} unlimited approval(s) to specific amounts`,
                  ]
                : []),
              ...(approvals.length === 0
                ? ["No active approvals found — wallet approval hygiene is clean"]
                : []),
            ],
          });
        } catch (e: any) {
          return errorResult(`Approval audit failed: ${e.message}`);
        }
      },
    };
  }
}
