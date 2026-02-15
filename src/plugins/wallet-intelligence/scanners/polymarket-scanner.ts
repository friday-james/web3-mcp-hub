import type {
  ProtocolScanner,
  ProtocolPosition,
} from "../../../core/scanner-types.js";
import type { PluginContext } from "../../../core/types.js";
import { DATA_API } from "../../polymarket/addresses.js";

export class PolymarketScanner implements ProtocolScanner {
  readonly protocolName = "Polymarket";
  readonly supportedChains = ["polygon"];

  async scanPositions(
    chainId: string,
    walletAddress: string,
    _context: PluginContext
  ): Promise<ProtocolPosition[]> {
    if (chainId !== "polygon") return [];

    try {
      const res = await fetch(
        `${DATA_API}/positions?user=${walletAddress.toLowerCase()}`
      );
      if (!res.ok) return [];
      const positions = await res.json();

      if (!Array.isArray(positions) || positions.length === 0) return [];

      let totalValueUsd = 0;
      const assets = positions
        .filter((p: any) => parseFloat(p.size) > 0)
        .map((p: any) => {
          const value = parseFloat(p.currentValue) || 0;
          totalValueUsd += value;
          return {
            symbol: (p.title || p.outcome || "Unknown").slice(0, 50),
            address: p.asset || "",
            balance: p.size || "0",
            balanceUsd: value,
          };
        });

      if (assets.length === 0) return [];

      return [
        {
          protocol: "Polymarket",
          type: "prediction-market",
          chainId,
          chainName: "Polygon",
          assets,
          totalValueUsd,
        },
      ];
    } catch {
      return [];
    }
  }
}
