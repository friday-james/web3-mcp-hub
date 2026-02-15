import { z } from "zod";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";

const GOPLUS_API = "https://api.gopluslabs.io/api/v1";

const CHAIN_ID_MAP: Record<string, string> = {
  ethereum: "1",
  bsc: "56",
  polygon: "137",
  arbitrum: "42161",
  optimism: "10",
  base: "8453",
  avalanche: "43114",
};

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function errorResult(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }], isError: true };
}

export class SecurityPlugin implements DefiPlugin {
  readonly name = "security";
  readonly description = "Token and address security checks: honeypot detection, ownership analysis, risk scoring";
  readonly version = "1.0.0";

  async initialize(_ctx: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [this.tokenSecurityTool(), this.addressSecurityTool()];
  }

  private tokenSecurityTool(): ToolDefinition {
    return {
      name: "defi_token_security",
      description: `Check if a token is safe: honeypot detection, ownership risks, buy/sell tax, proxy status, mintable status. Supported chains: ${Object.keys(CHAIN_ID_MAP).join(", ")}.`,
      inputSchema: z.object({
        chainId: z.string().describe("Chain ID"),
        contractAddress: z.string().describe("Token contract address to check"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { chainId, contractAddress } = input as {
            chainId: string; contractAddress: string;
          };
          const numericId = CHAIN_ID_MAP[chainId];
          if (!numericId) return errorResult(`Security check not available on "${chainId}". Supported: ${Object.keys(CHAIN_ID_MAP).join(", ")}`);

          const url = `${GOPLUS_API}/token_security/${numericId}?contract_addresses=${contractAddress.toLowerCase()}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error(`GoPlus API ${res.status}`);
          const data = await res.json();

          if (data.code !== 1) throw new Error(data.message || "API error");

          const addr = contractAddress.toLowerCase();
          const info = data.result?.[addr];
          if (!info) return errorResult(`No security data found for ${contractAddress}`);

          const risks: string[] = [];
          if (info.is_honeypot === "1") risks.push("HONEYPOT - cannot sell");
          if (info.is_proxy === "1") risks.push("Proxy contract - can be modified");
          if (info.is_mintable === "1") risks.push("Mintable - supply can increase");
          if (info.can_take_back_ownership === "1") risks.push("Ownership can be reclaimed");
          if (info.hidden_owner === "1") risks.push("Hidden owner detected");
          if (info.cannot_sell_all === "1") risks.push("Cannot sell all tokens");
          if (info.trading_cooldown === "1") risks.push("Trading cooldown enabled");
          if (info.is_blacklisted === "1") risks.push("Has blacklist function");
          if (info.is_whitelisted === "1") risks.push("Has whitelist function");
          if (info.external_call === "1") risks.push("Makes external calls");

          const buyTax = info.buy_tax ? `${(Number(info.buy_tax) * 100).toFixed(1)}%` : "0%";
          const sellTax = info.sell_tax ? `${(Number(info.sell_tax) * 100).toFixed(1)}%` : "0%";

          const riskLevel = risks.length === 0 ? "LOW" : risks.length <= 2 ? "MEDIUM" : "HIGH";

          return jsonResult({
            chain: chainId,
            token: contractAddress,
            name: info.token_name,
            symbol: info.token_symbol,
            riskLevel,
            risks: risks.length > 0 ? risks : ["No risks detected"],
            buyTax,
            sellTax,
            isOpenSource: info.is_open_source === "1",
            isProxy: info.is_proxy === "1",
            isMintable: info.is_mintable === "1",
            isHoneypot: info.is_honeypot === "1",
            ownerAddress: info.owner_address,
            holderCount: info.holder_count,
            lpHolderCount: info.lp_holder_count,
            totalSupply: info.total_supply,
          });
        } catch (e: any) {
          return errorResult(`Token security check failed: ${e.message}`);
        }
      },
    };
  }

  private addressSecurityTool(): ToolDefinition {
    return {
      name: "defi_address_security",
      description:
        "Check if a wallet or contract address is associated with known malicious activity: phishing, scams, money laundering, sanctions.",
      inputSchema: z.object({
        address: z.string().describe("Address to check"),
        chainId: z.string().optional().describe("Chain ID (optional, defaults to all)"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { address, chainId } = input as { address: string; chainId?: string };
          const numericId = chainId ? CHAIN_ID_MAP[chainId] || chainId : undefined;
          const params = numericId ? `?chain_id=${numericId}` : "";

          const url = `${GOPLUS_API}/address_security/${address}${params}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error(`GoPlus API ${res.status}`);
          const data = await res.json();

          if (data.code !== 1) throw new Error(data.message || "API error");

          const info = data.result || {};
          const risks: string[] = [];

          if (info.phishing_activities === "1") risks.push("Phishing activities");
          if (info.blackmail_activities === "1") risks.push("Blackmail activities");
          if (info.stealing_attack === "1") risks.push("Stealing attack");
          if (info.cybercrime === "1") risks.push("Cybercrime");
          if (info.money_laundering === "1") risks.push("Money laundering");
          if (info.financial_crime === "1") risks.push("Financial crime");
          if (info.darkweb_transactions === "1") risks.push("Darkweb transactions");
          if (info.sanctioned === "1") risks.push("SANCTIONED address");
          if (info.honeypot_related_address === "1") risks.push("Honeypot related");
          if (info.fake_kyc === "1") risks.push("Fake KYC");

          const riskLevel = risks.length === 0 ? "CLEAN" : "DANGEROUS";

          return jsonResult({
            address,
            riskLevel,
            risks: risks.length > 0 ? risks : ["No known malicious activity"],
            isContract: info.contract_address === "1",
            dataSource: info.data_source || "GoPlus",
          });
        } catch (e: any) {
          return errorResult(`Address security check failed: ${e.message}`);
        }
      },
    };
  }
}
