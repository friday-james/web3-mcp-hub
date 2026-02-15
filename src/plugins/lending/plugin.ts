import { z } from "zod";
import {
  createPublicClient,
  http,
  getAddress,
  encodeFunctionData,
  formatUnits,
  maxUint256,
} from "viem";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";
import { ChainIdSchema, AddressSchema, AmountSchema } from "../../tools/schemas.js";
import { parseTokenAmount } from "../../core/utils.js";
import { AAVE_V3_ADDRESSES, getSupportedLendingChains } from "./aave-addresses.js";
import { UI_POOL_DATA_PROVIDER_ABI, POOL_ABI, rayToApy } from "./aave-abi.js";

export class LendingPlugin implements DefiPlugin {
  readonly name = "lending";
  readonly description = "Aave V3 lending protocol: markets, positions, supply, borrow, withdraw, repay";
  readonly version = "1.0.0";

  async initialize(_context: PluginContext): Promise<void> {}

  /** readContract wrapper that tries without gas limit first, then with explicit gas */
  private async readContractSafe(
    client: ReturnType<typeof createPublicClient>,
    params: { address: `0x${string}`; abi: readonly any[]; functionName: string; args: readonly any[] }
  ) {
    try {
      return await client.readContract(params as any);
    } catch (e: any) {
      // If out of gas on public RPC, retry without gas limit specification
      if (e?.details?.includes?.("out of gas") || e?.details?.includes?.("gas limit")) {
        throw new Error(
          `RPC gas limit too low for this call. Set a custom RPC_ETHEREUM with higher gas limits (e.g. Alchemy, Infura) in your .env file.`
        );
      }
      throw e;
    }
  }

  getTools(): ToolDefinition[] {
    return [
      this.marketsTools(),
      this.userPositionTool(),
      this.supplyTxTool(),
      this.withdrawTxTool(),
      this.borrowTxTool(),
      this.repayTxTool(),
    ];
  }

  private marketsTools(): ToolDefinition {
    return {
      name: "defi_lending_markets",
      description: `List Aave V3 lending markets on a chain with supply APY, borrow APY, total liquidity, and utilization. Supported chains: ${getSupportedLendingChains().join(", ")}.`,
      inputSchema: z.object({
        chainId: ChainIdSchema,
      }),
      handler: async (input: unknown, context: PluginContext): Promise<ToolResult> => {
        const { chainId } = input as { chainId: string };
        const addrs = AAVE_V3_ADDRESSES[chainId];
        if (!addrs) {
          return {
            content: [{ type: "text", text: `Aave V3 not available on "${chainId}". Supported: ${getSupportedLendingChains().join(", ")}` }],
            isError: true,
          };
        }

        const chain = context.getChainAdapterForChain(chainId).getChain(chainId)!;
        const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
        const client = createPublicClient({
          transport: http(rpcUrl, { batch: true }),
          batch: { multicall: true },
        });

        const reservesResult = await this.readContractSafe(client, {
          address: addrs.uiPoolDataProvider,
          abi: UI_POOL_DATA_PROVIDER_ABI,
          functionName: "getReservesData",
          args: [addrs.poolAddressesProvider],
        }) as readonly [any[], any];
        const [reserves, baseCurrency] = reservesResult;

        const ethPriceUsd = Number(baseCurrency.networkBaseTokenPriceInUsd) /
          (10 ** baseCurrency.networkBaseTokenPriceDecimals);
        const refUnit = Number(baseCurrency.marketReferenceCurrencyUnit);

        const markets = reserves
          .filter((r) => r.isActive && !r.isPaused)
          .map((r) => {
            const supplyApy = rayToApy(r.liquidityRate);
            const borrowApy = rayToApy(r.variableBorrowRate);
            const decimals = Number(r.decimals);
            const priceUsd = (Number(r.priceInMarketReferenceCurrency) / refUnit) *
              (Number(baseCurrency.marketReferenceCurrencyPriceInUsd) / (10 ** baseCurrency.networkBaseTokenPriceDecimals));

            const availableLiquidity = Number(formatUnits(r.availableLiquidity, decimals));
            const totalVariableDebt = Number(formatUnits(r.totalScaledVariableDebt, decimals));
            const totalStableDebt = Number(formatUnits(r.totalPrincipalStableDebt, decimals));
            const totalSupplied = availableLiquidity + totalVariableDebt + totalStableDebt;
            const utilization = totalSupplied > 0
              ? ((totalVariableDebt + totalStableDebt) / totalSupplied * 100)
              : 0;

            return {
              asset: r.symbol,
              address: r.underlyingAsset,
              supplyApy: `${supplyApy.toFixed(2)}%`,
              borrowApy: `${borrowApy.toFixed(2)}%`,
              totalSupplied: `${totalSupplied.toFixed(2)} ${r.symbol}`,
              totalSuppliedUsd: `$${(totalSupplied * priceUsd).toFixed(0)}`,
              availableLiquidity: `${availableLiquidity.toFixed(2)} ${r.symbol}`,
              utilization: `${utilization.toFixed(1)}%`,
              canCollateral: r.usageAsCollateralEnabled,
              canBorrow: r.borrowingEnabled,
              ltv: `${Number(r.baseLTVasCollateral) / 100}%`,
              liquidationThreshold: `${Number(r.reserveLiquidationThreshold) / 100}%`,
              isFrozen: r.isFrozen,
            };
          });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              chain: chain.name,
              protocol: "Aave V3",
              marketsCount: markets.length,
              markets,
            }, null, 2),
          }],
        };
      },
    };
  }

  private userPositionTool(): ToolDefinition {
    return {
      name: "defi_lending_position",
      description:
        "Get a user's Aave V3 lending position including supplied assets, borrowed assets, health factor, and available borrows.",
      inputSchema: z.object({
        chainId: ChainIdSchema,
        userAddress: AddressSchema.describe("User wallet address"),
      }),
      handler: async (input: unknown, context: PluginContext): Promise<ToolResult> => {
        const { chainId, userAddress } = input as { chainId: string; userAddress: string };
        const addrs = AAVE_V3_ADDRESSES[chainId];
        if (!addrs) {
          return {
            content: [{ type: "text", text: `Aave V3 not available on "${chainId}"` }],
            isError: true,
          };
        }

        const chain = context.getChainAdapterForChain(chainId).getChain(chainId)!;
        const rpcUrl = context.config.rpcUrls[chainId] || chain.rpcUrl;
        const client = createPublicClient({
          transport: http(rpcUrl, { batch: true }),
          batch: { multicall: true },
        });
        const user = getAddress(userAddress);

        // Fetch account summary and user reserves in parallel
        const [accountData, userReservesResult, reservesResult] = await Promise.all([
          client.readContract({
            address: addrs.pool,
            abi: POOL_ABI,
            functionName: "getUserAccountData",
            args: [user],
          }),
          this.readContractSafe(client, {
            address: addrs.uiPoolDataProvider,
            abi: UI_POOL_DATA_PROVIDER_ABI,
            functionName: "getUserReservesData",
            args: [addrs.poolAddressesProvider, user],
          }) as Promise<readonly [any[], any]>,
          this.readContractSafe(client, {
            address: addrs.uiPoolDataProvider,
            abi: UI_POOL_DATA_PROVIDER_ABI,
            functionName: "getReservesData",
            args: [addrs.poolAddressesProvider],
          }) as Promise<readonly [any[], any]>,
        ]);
        const [userReserves] = userReservesResult;
        const [reserves, baseCurrency] = reservesResult;

        const refUnit = Number(baseCurrency.marketReferenceCurrencyUnit);
        const refPriceUsd = Number(baseCurrency.marketReferenceCurrencyPriceInUsd) /
          (10 ** baseCurrency.networkBaseTokenPriceDecimals);

        // Build reserve metadata lookup
        const reserveMap = new Map<string, { symbol: string; decimals: number; liquidityIndex: bigint; variableBorrowIndex: bigint; priceUsd: number }>();
        for (const r of reserves) {
          const priceUsd = (Number(r.priceInMarketReferenceCurrency) / refUnit) * refPriceUsd;
          reserveMap.set(r.underlyingAsset.toLowerCase(), {
            symbol: r.symbol,
            decimals: Number(r.decimals),
            liquidityIndex: r.liquidityIndex,
            variableBorrowIndex: r.variableBorrowIndex,
            priceUsd,
          });
        }

        const supplied: Array<Record<string, unknown>> = [];
        const borrowed: Array<Record<string, unknown>> = [];

        for (const ur of userReserves) {
          const meta = reserveMap.get(ur.underlyingAsset.toLowerCase());
          if (!meta) continue;

          // Supplied = scaledATokenBalance * liquidityIndex / RAY
          if (ur.scaledATokenBalance > 0n) {
            const actualBalance = (ur.scaledATokenBalance * meta.liquidityIndex) / (10n ** 27n);
            const formatted = Number(formatUnits(actualBalance, meta.decimals));
            supplied.push({
              asset: meta.symbol,
              address: ur.underlyingAsset,
              balance: formatted.toFixed(6),
              balanceUsd: `$${(formatted * meta.priceUsd).toFixed(2)}`,
              usedAsCollateral: ur.usageAsCollateralEnabledOnUser,
            });
          }

          // Variable debt
          if (ur.scaledVariableDebt > 0n) {
            const actualDebt = (ur.scaledVariableDebt * meta.variableBorrowIndex) / (10n ** 27n);
            const formatted = Number(formatUnits(actualDebt, meta.decimals));
            borrowed.push({
              asset: meta.symbol,
              address: ur.underlyingAsset,
              balance: formatted.toFixed(6),
              balanceUsd: `$${(formatted * meta.priceUsd).toFixed(2)}`,
              rateMode: "variable",
            });
          }

          // Stable debt
          if (ur.principalStableDebt > 0n) {
            const formatted = Number(formatUnits(ur.principalStableDebt, meta.decimals));
            borrowed.push({
              asset: meta.symbol,
              address: ur.underlyingAsset,
              balance: formatted.toFixed(6),
              balanceUsd: `$${(formatted * meta.priceUsd).toFixed(2)}`,
              rateMode: "stable",
            });
          }
        }

        // Health factor: 10^18 based, > 1 is safe
        const healthFactor = accountData[5] >= maxUint256 / 2n
          ? "infinite (no borrows)"
          : (Number(accountData[5]) / 1e18).toFixed(4);

        const totalCollateralUsd = (Number(accountData[0]) / refUnit) * refPriceUsd;
        const totalDebtUsd = (Number(accountData[1]) / refUnit) * refPriceUsd;
        const availableBorrowsUsd = (Number(accountData[2]) / refUnit) * refPriceUsd;

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              chain: chain.name,
              protocol: "Aave V3",
              user: userAddress,
              healthFactor,
              totalCollateralUsd: `$${totalCollateralUsd.toFixed(2)}`,
              totalDebtUsd: `$${totalDebtUsd.toFixed(2)}`,
              availableBorrowsUsd: `$${availableBorrowsUsd.toFixed(2)}`,
              ltv: `${(Number(accountData[4]) / 100).toFixed(2)}%`,
              supplied,
              borrowed,
            }, null, 2),
          }],
        };
      },
    };
  }

  private supplyTxTool(): ToolDefinition {
    return {
      name: "defi_lending_supply_tx",
      description:
        "Build an unsigned transaction to supply (deposit) assets into Aave V3. The asset must be approved first via defi_token_approve.",
      inputSchema: z.object({
        chainId: ChainIdSchema,
        asset: z.string().describe("Token symbol or address to supply"),
        amount: AmountSchema,
        userAddress: AddressSchema,
      }),
      handler: async (input: unknown, context: PluginContext): Promise<ToolResult> => {
        const { chainId, asset, amount, userAddress } = input as {
          chainId: string; asset: string; amount: string; userAddress: string;
        };
        return this.buildPoolTx(chainId, asset, amount, userAddress, "supply", context);
      },
    };
  }

  private withdrawTxTool(): ToolDefinition {
    return {
      name: "defi_lending_withdraw_tx",
      description:
        "Build an unsigned transaction to withdraw supplied assets from Aave V3. Use amount 'max' to withdraw everything.",
      inputSchema: z.object({
        chainId: ChainIdSchema,
        asset: z.string().describe("Token symbol or address to withdraw"),
        amount: AmountSchema.describe('Amount to withdraw, or "max" for full balance'),
        userAddress: AddressSchema,
      }),
      handler: async (input: unknown, context: PluginContext): Promise<ToolResult> => {
        const { chainId, asset, amount, userAddress } = input as {
          chainId: string; asset: string; amount: string; userAddress: string;
        };
        return this.buildPoolTx(chainId, asset, amount, userAddress, "withdraw", context);
      },
    };
  }

  private borrowTxTool(): ToolDefinition {
    return {
      name: "defi_lending_borrow_tx",
      description:
        "Build an unsigned transaction to borrow assets from Aave V3. Requires sufficient collateral deposited first.",
      inputSchema: z.object({
        chainId: ChainIdSchema,
        asset: z.string().describe("Token symbol or address to borrow"),
        amount: AmountSchema,
        userAddress: AddressSchema,
      }),
      handler: async (input: unknown, context: PluginContext): Promise<ToolResult> => {
        const { chainId, asset, amount, userAddress } = input as {
          chainId: string; asset: string; amount: string; userAddress: string;
        };
        return this.buildPoolTx(chainId, asset, amount, userAddress, "borrow", context);
      },
    };
  }

  private repayTxTool(): ToolDefinition {
    return {
      name: "defi_lending_repay_tx",
      description:
        "Build an unsigned transaction to repay borrowed assets on Aave V3. Use amount 'max' to repay full debt. Must approve the token first.",
      inputSchema: z.object({
        chainId: ChainIdSchema,
        asset: z.string().describe("Token symbol or address to repay"),
        amount: AmountSchema.describe('Amount to repay, or "max" for full debt'),
        userAddress: AddressSchema,
      }),
      handler: async (input: unknown, context: PluginContext): Promise<ToolResult> => {
        const { chainId, asset, amount, userAddress } = input as {
          chainId: string; asset: string; amount: string; userAddress: string;
        };
        return this.buildPoolTx(chainId, asset, amount, userAddress, "repay", context);
      },
    };
  }

  private async buildPoolTx(
    chainId: string,
    asset: string,
    amount: string,
    userAddress: string,
    action: "supply" | "withdraw" | "borrow" | "repay",
    context: PluginContext
  ): Promise<ToolResult> {
    const addrs = AAVE_V3_ADDRESSES[chainId];
    if (!addrs) {
      return {
        content: [{ type: "text", text: `Aave V3 not available on "${chainId}"` }],
        isError: true,
      };
    }

    const adapter = context.getChainAdapterForChain(chainId);
    const resolved = await adapter.resolveToken(chainId, asset);
    if (!resolved) {
      return {
        content: [{ type: "text", text: `Token "${asset}" not found on "${chainId}"` }],
        isError: true,
      };
    }

    const user = getAddress(userAddress);
    const assetAddr = getAddress(resolved.address);
    const isMax = amount.toLowerCase() === "max";
    const rawAmount = isMax ? maxUint256 : BigInt(parseTokenAmount(amount, resolved.decimals));

    let data: `0x${string}`;
    let description: string;

    switch (action) {
      case "supply":
        data = encodeFunctionData({
          abi: POOL_ABI,
          functionName: "supply",
          args: [assetAddr, rawAmount, user, 0],
        });
        description = `Supply ${amount} ${resolved.symbol} to Aave V3`;
        break;
      case "withdraw":
        data = encodeFunctionData({
          abi: POOL_ABI,
          functionName: "withdraw",
          args: [assetAddr, rawAmount, user],
        });
        description = `Withdraw ${isMax ? "all" : amount} ${resolved.symbol} from Aave V3`;
        break;
      case "borrow":
        data = encodeFunctionData({
          abi: POOL_ABI,
          functionName: "borrow",
          args: [assetAddr, rawAmount, 2n, 0, user], // 2 = variable rate
        });
        description = `Borrow ${amount} ${resolved.symbol} from Aave V3 (variable rate)`;
        break;
      case "repay":
        data = encodeFunctionData({
          abi: POOL_ABI,
          functionName: "repay",
          args: [assetAddr, rawAmount, 2n, user], // 2 = variable rate
        });
        description = `Repay ${isMax ? "all" : amount} ${resolved.symbol} debt on Aave V3`;
        break;
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          chainId,
          ecosystem: "evm",
          raw: {
            to: addrs.pool,
            data,
            value: "0x0",
            from: user,
          },
          description,
          note: action === "supply" || action === "repay"
            ? `Make sure ${resolved.symbol} is approved for ${addrs.pool} first (use defi_token_approve)`
            : undefined,
        }, null, 2),
      }],
    };
  }
}
