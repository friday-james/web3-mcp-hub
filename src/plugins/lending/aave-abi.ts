/** Minimal ABI fragments for Aave V3 on-chain reads and tx building */

export const UI_POOL_DATA_PROVIDER_ABI = [
  {
    name: "getReservesData",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "provider", type: "address" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "underlyingAsset", type: "address" },
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
          { name: "decimals", type: "uint256" },
          { name: "baseLTVasCollateral", type: "uint256" },
          { name: "reserveLiquidationThreshold", type: "uint256" },
          { name: "reserveLiquidationBonus", type: "uint256" },
          { name: "reserveFactor", type: "uint256" },
          { name: "usageAsCollateralEnabled", type: "bool" },
          { name: "borrowingEnabled", type: "bool" },
          { name: "stableBorrowRateEnabled", type: "bool" },
          { name: "isActive", type: "bool" },
          { name: "isFrozen", type: "bool" },
          { name: "liquidityIndex", type: "uint128" },
          { name: "variableBorrowIndex", type: "uint128" },
          { name: "liquidityRate", type: "uint128" },
          { name: "variableBorrowRate", type: "uint128" },
          { name: "stableBorrowRate", type: "uint128" },
          { name: "lastUpdateTimestamp", type: "uint40" },
          { name: "aTokenAddress", type: "address" },
          { name: "stableDebtTokenAddress", type: "address" },
          { name: "variableDebtTokenAddress", type: "address" },
          { name: "interestRateStrategyAddress", type: "address" },
          { name: "availableLiquidity", type: "uint256" },
          { name: "totalPrincipalStableDebt", type: "uint256" },
          { name: "averageStableRate", type: "uint256" },
          { name: "stableDebtLastUpdateTimestamp", type: "uint256" },
          { name: "totalScaledVariableDebt", type: "uint256" },
          { name: "priceInMarketReferenceCurrency", type: "uint256" },
          { name: "priceOracle", type: "address" },
          { name: "variableRateSlope1", type: "uint256" },
          { name: "variableRateSlope2", type: "uint256" },
          { name: "stableRateSlope1", type: "uint256" },
          { name: "stableRateSlope2", type: "uint256" },
          { name: "baseStableBorrowRate", type: "uint256" },
          { name: "baseVariableBorrowRate", type: "uint256" },
          { name: "optimalUsageRatio", type: "uint256" },
          { name: "isPaused", type: "bool" },
          { name: "isSiloedBorrowing", type: "bool" },
          { name: "accruedToTreasury", type: "uint128" },
          { name: "unbacked", type: "uint128" },
          { name: "isolationModeTotalDebt", type: "uint128" },
          { name: "flashLoanEnabled", type: "bool" },
          { name: "debtCeiling", type: "uint256" },
          { name: "debtCeilingDecimals", type: "uint256" },
          { name: "eModeCategoryId", type: "uint8" },
          { name: "borrowCap", type: "uint256" },
          { name: "supplyCap", type: "uint256" },
          { name: "eModeLtv", type: "uint16" },
          { name: "eModeLiquidationThreshold", type: "uint16" },
          { name: "eModeLiquidationBonus", type: "uint16" },
          { name: "eModePriceSource", type: "address" },
          { name: "eModeLabel", type: "string" },
          { name: "borrowableInIsolation", type: "bool" },
        ],
      },
      {
        name: "",
        type: "tuple",
        components: [
          { name: "marketReferenceCurrencyUnit", type: "uint256" },
          { name: "marketReferenceCurrencyPriceInUsd", type: "int256" },
          { name: "networkBaseTokenPriceInUsd", type: "int256" },
          { name: "networkBaseTokenPriceDecimals", type: "uint8" },
        ],
      },
    ],
  },
  {
    name: "getUserReservesData",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "provider", type: "address" },
      { name: "user", type: "address" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "underlyingAsset", type: "address" },
          { name: "scaledATokenBalance", type: "uint256" },
          { name: "usageAsCollateralEnabledOnUser", type: "bool" },
          { name: "stableBorrowRate", type: "uint256" },
          { name: "scaledVariableDebt", type: "uint256" },
          { name: "principalStableDebt", type: "uint256" },
          { name: "stableBorrowLastUpdateTimestamp", type: "uint256" },
        ],
      },
      { name: "", type: "uint8" },
    ],
  },
] as const;

export const POOL_ABI = [
  {
    name: "supply",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
      { name: "referralCode", type: "uint16" },
    ],
    outputs: [],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "borrow",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "interestRateMode", type: "uint256" },
      { name: "referralCode", type: "uint16" },
      { name: "onBehalfOf", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "repay",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "interestRateMode", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getUserAccountData",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "totalCollateralBase", type: "uint256" },
      { name: "totalDebtBase", type: "uint256" },
      { name: "availableBorrowsBase", type: "uint256" },
      { name: "currentLiquidationThreshold", type: "uint256" },
      { name: "ltv", type: "uint256" },
      { name: "healthFactor", type: "uint256" },
    ],
  },
] as const;

/** RAY = 10^27, used for Aave rate calculations */
export const RAY = 10n ** 27n;

/** Convert Aave ray rate (10^27) to APY percentage */
export function rayToApy(rayRate: bigint): number {
  // APY = rate / RAY * 100
  return Number((rayRate * 10000n) / RAY) / 100;
}
