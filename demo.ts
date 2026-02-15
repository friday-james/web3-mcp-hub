/**
 * DeFi MCP — Product Demo
 *
 * AI-native middleware for all of DeFi.
 * One server. Every protocol. Every chain.
 *
 * This demo walks through the full capability set:
 *   1. Infrastructure overview (chains, tools)
 *   2. Real-time market data
 *   3. Wallet scanning across all protocols
 *   4. Yield optimization across chains
 *   5. Transaction building
 *   6. Cross-chain swaps
 *
 * Run: npx tsx demo.ts [wallet_address]
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// ── Formatting helpers ──────────────────────────────────────
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const CHECK = `${GREEN}✓${RESET}`;
const ARROW = `${CYAN}→${RESET}`;

function header(text: string) {
  console.log(`\n${BOLD}${CYAN}${"━".repeat(60)}${RESET}`);
  console.log(`${BOLD}${CYAN}  ${text}${RESET}`);
  console.log(`${BOLD}${CYAN}${"━".repeat(60)}${RESET}\n`);
}

function subheader(text: string) {
  console.log(`\n  ${BOLD}${text}${RESET}`);
  console.log(`  ${DIM}${"─".repeat(50)}${RESET}`);
}

function line(label: string, value: string) {
  console.log(`  ${DIM}${label.padEnd(28)}${RESET}${BOLD}${value}${RESET}`);
}

function step(n: number, text: string) {
  console.log(`  ${YELLOW}Step ${n}:${RESET} ${text}`);
}

async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<any> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ text: string }>)[0]?.text;
  if (result.isError) throw new Error(text);
  return JSON.parse(text);
}

// ── Main Demo Flow ──────────────────────────────────────────
async function main() {
  const walletArg = process.argv[2];

  console.log(`\n${BOLD}${MAGENTA}`);
  console.log(`  ╔══════════════════════════════════════════════╗`);
  console.log(`  ║                                              ║`);
  console.log(`  ║            DeFi MCP — Live Demo              ║`);
  console.log(`  ║                                              ║`);
  console.log(`  ║   AI-native middleware for all of DeFi       ║`);
  console.log(`  ║   One server. Every protocol. Every chain.   ║`);
  console.log(`  ║                                              ║`);
  console.log(`  ╚══════════════════════════════════════════════╝${RESET}`);

  // Connect to MCP server
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
  });
  const client = new Client({ name: "demo", version: "1.0.0" });
  await client.connect(transport);

  // ── 1: Show supported infrastructure ──────────────────────
  header("1. Infrastructure — chains, ecosystems, tools");

  const chains = await callTool(client, "defi_get_chains", {});
  console.log(`  ${CHECK} ${BOLD}${chains.length} chains${RESET} supported across 3 ecosystems:`);
  const ecosystems = new Map<string, string[]>();
  for (const c of chains) {
    if (!ecosystems.has(c.ecosystem)) ecosystems.set(c.ecosystem, []);
    ecosystems.get(c.ecosystem)!.push(c.name);
  }
  for (const [eco, names] of ecosystems) {
    console.log(`    ${ARROW} ${BOLD}${eco.toUpperCase()}${RESET}: ${names.join(", ")}`);
  }

  const tools = await client.listTools();
  console.log(`\n  ${CHECK} ${BOLD}${tools.tools.length} MCP tools${RESET} available:`);
  const categories = {
    "Intelligence": ["defi_wallet_scan", "defi_find_best_yield"],
    "Trading": ["defi_swap_quote", "defi_swap_build_tx"],
    "Lending": ["defi_lending_markets", "defi_lending_position", "defi_lending_supply_tx", "defi_lending_borrow_tx"],
    "Cross-chain": ["defi_bridge_quote"],
    "Data": ["defi_token_info", "defi_token_price", "defi_get_balances", "defi_portfolio", "defi_gas_price"],
    "Utilities": ["defi_resolve_ens", "defi_token_approve", "defi_check_allowance", "defi_tx_status"],
  };
  for (const [cat, toolNames] of Object.entries(categories)) {
    const available = toolNames.filter((t) => tools.tools.some((tt) => tt.name === t));
    console.log(`    ${ARROW} ${BOLD}${cat}${RESET}: ${available.join(", ")}`);
  }

  // ── 2: Real-time token data ───────────────────────────────
  header("2. Real-time Market Data");

  console.log(`  ${DIM}Fetching live prices across chains...${RESET}`);
  try {
    const prices = await callTool(client, "defi_token_price", {
      tokens: [
        { chainId: "ethereum", token: "ETH" },
        { chainId: "ethereum", token: "USDC" },
        { chainId: "solana-mainnet", token: "SOL" },
      ],
    });

    for (const p of prices) {
      const change = p.priceChange24h
        ? `${p.priceChange24h > 0 ? GREEN + "+" : RED}${p.priceChange24h.toFixed(2)}%${RESET}`
        : "";
      const symbol = p.token?.symbol || "?";
      const chain = p.token?.chainId || "?";
      line(`${symbol} (${chain})`, `$${p.priceUsd.toLocaleString()} ${change}`);
    }
  } catch (err: any) {
    console.log(`  ${DIM}Price fetch skipped (rate limit): ${err.message?.slice(0, 50)}${RESET}`);
  }

  // ── 3: Wallet Intelligence ────────────────────────────────
  header("3. Wallet Intelligence — one call, full breakdown");

  const scanAddr = walletArg || "0x053D55f9B5AF8694c503EB288a1B7E552f590710";

  console.log(`  ${DIM}Scanning wallet across all protocols...${RESET}`);
  console.log(`  ${DIM}Address: ${scanAddr}${RESET}\n`);

  const scan = await callTool(client, "defi_wallet_scan", {
    address: scanAddr,
    chainIds: ["arbitrum", "base"],
  });

  line("Total Portfolio Value", scan.totalValueUsd);
  line("Protocols Scanned", scan.protocolsScanned.join(", "));
  line("Chains Scanned", scan.chainsScanned.join(", "));

  if (scan.summary?.byProtocol) {
    subheader("Breakdown by Protocol");
    for (const [name, data] of Object.entries(scan.summary.byProtocol) as any) {
      line(`  ${name}`, `${data.totalUsd} (${data.positionCount} position${data.positionCount > 1 ? "s" : ""})`);
    }
  }

  if (scan.positions) {
    for (const pos of scan.positions as any[]) {
      if (pos.type === "lending-supply" && pos.assets?.length > 0) {
        subheader(`Aave V3 Supplied Assets (${pos.chainName})`);
        for (const a of pos.assets.slice(0, 5)) {
          const apyStr = a.apy ? ` ${GREEN}${a.apy.toFixed(2)}% APY${RESET}` : "";
          line(`  ${a.symbol}`, `${a.balance} (${a.balanceUsd})${apyStr}`);
        }
        if (pos.assets.length > 5) {
          console.log(`  ${DIM}  ... and ${pos.assets.length - 5} more assets${RESET}`);
        }
      }
    }
  }

  // ── 4: Yield Optimization ─────────────────────────────────
  header("4. Yield Optimization — best yield across all chains");

  console.log(`  ${DIM}Query: "Find the best yield for 10,000 USDC"${RESET}`);
  console.log(`  ${DIM}Scanning Aave V3 across all supported chains...${RESET}\n`);

  const yield_ = await callTool(client, "defi_find_best_yield", {
    token: "USDC",
    amount: "10000",
    currentChainId: "arbitrum",
    timeHorizonDays: 365,
  });

  line("Opportunities Found", `${yield_.opportunitiesFound}`);

  if (yield_.bestOpportunity) {
    const best = yield_.bestOpportunity;
    subheader(`Best: ${best.protocol} on ${best.chainName}`);
    line("  Gross APY", `${GREEN}${best.grossApy}${RESET}`);
    line("  Gas Cost", best.gasCostUsd);
    line("  Bridge Cost", best.bridgeCostUsd);
    line("  Net APY", `${GREEN}${best.netApy}${RESET}`);
    line("  Est. Yield (1yr)", `${GREEN}${best.estimatedNetYieldUsd}${RESET}`);
    line("  TVL", best.tvl || "N/A");

    subheader("Execution Plan");
    for (let i = 0; i < best.executionSteps.length; i++) {
      step(i + 1, best.executionSteps[i]);
    }
  }

  if (yield_.allOpportunities && yield_.allOpportunities.length > 1) {
    subheader("All Opportunities (ranked by Net APY)");
    for (const opp of yield_.allOpportunities as any[]) {
      console.log(
        `  ${ARROW} ${BOLD}${opp.chainName}${RESET}: ${GREEN}${opp.grossApy}${RESET} gross, ` +
        `${opp.netApy} net | gas: ${opp.gasCostUsd}, bridge: ${opp.bridgeCostUsd}`
      );
    }
  }

  // ── 5: Transaction Building ───────────────────────────────
  header("5. Transaction Building — unsigned tx, ready to sign");

  if (yield_.bestOpportunity) {
    const best = yield_.bestOpportunity;
    console.log(`  ${DIM}Building supply transaction for ${best.chainName}...${RESET}\n`);

    const tx = await callTool(client, "defi_lending_supply_tx", {
      chainId: best.chainId,
      asset: "USDC",
      amount: "10000",
      userAddress: scanAddr,
    });

    line("Action", tx.description);
    line("Chain", tx.chainId);
    line("To (Aave Pool)", tx.raw.to);
    line("Calldata", tx.raw.data.slice(0, 20) + "...");
    line("Value", tx.raw.value);
    if (tx.note) {
      console.log(`\n  ${YELLOW}Note:${RESET} ${tx.note}`);
    }
  }

  // ── 6: Cross-chain Swap ───────────────────────────────────
  header("6. Cross-chain Swap — instant quotes");

  console.log(`  ${DIM}Getting swap quote: 1 ETH → USDC on Arbitrum...${RESET}\n`);

  try {
    const quote = await callTool(client, "defi_swap_quote", {
      chainId: "arbitrum",
      srcToken: "ETH",
      dstToken: "USDC",
      amount: "1",
    });

    line("Input", `1 ETH`);
    line("Output", `${parseFloat(quote.amountOut).toFixed(2)} USDC`);
    line("Min Output", `${parseFloat(quote.minimumAmountOut).toFixed(2)} USDC`);
    line("Aggregator", quote.aggregator);
    if (quote.priceImpact) line("Price Impact", quote.priceImpact);
  } catch (err: any) {
    console.log(`  ${DIM}Swap quote skipped: ${err.message?.slice(0, 60)}${RESET}`);
  }

  // ── Summary ────────────────────────────────────────────────
  header("Summary");

  console.log(`  ${CHECK} Scanned ${scan.chainsScanned.length} chains, ${scan.protocolsScanned.length} protocols`);
  console.log(`  ${CHECK} Found ${scan.totalValueUsd} in DeFi positions`);
  console.log(`  ${CHECK} Compared yield across ${yield_.opportunitiesFound} chains`);
  console.log(`  ${CHECK} Built execution plan with unsigned transactions`);
  console.log(`  ${CHECK} Cross-chain swap quotes via aggregator`);
  console.log();
  console.log(`  ${BOLD}${tools.tools.length} tools${RESET} across ${BOLD}${chains.length} chains${RESET} — all through MCP.`);
  console.log(`  Any AI agent can plug into this server and interact`);
  console.log(`  with DeFi natively. Add a protocol = implement 1 interface.`);
  console.log();

  await client.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
