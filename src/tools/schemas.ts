import { z } from "zod";

export const ChainIdSchema = z
  .string()
  .describe(
    'Chain identifier (e.g. "ethereum", "base", "solana-mainnet", "osmosis-1")'
  );

export const AddressSchema = z
  .string()
  .describe("Wallet or token address");

export const AmountSchema = z
  .string()
  .describe('Human-readable amount (e.g. "1.5")');

export const SlippageSchema = z
  .number()
  .int()
  .min(1)
  .max(5000)
  .optional()
  .describe(
    "Slippage tolerance in basis points (e.g. 50 = 0.5%). Defaults to 50."
  );

export const TokenInfoInputSchema = z.object({
  chainId: ChainIdSchema,
  token: z
    .string()
    .describe('Token symbol (e.g. "USDC") or contract address'),
});

export const TokenPriceInputSchema = z.object({
  tokens: z
    .array(
      z.object({
        chainId: ChainIdSchema,
        token: z.string().describe("Token symbol or address"),
      })
    )
    .min(1)
    .max(20),
});

export const GetBalancesInputSchema = z.object({
  chainId: ChainIdSchema,
  address: AddressSchema,
  tokens: z
    .array(z.string())
    .optional()
    .describe(
      "Token addresses to check. If omitted, returns native token balance only."
    ),
});

export const SwapQuoteInputSchema = z.object({
  chainId: ChainIdSchema,
  srcToken: z.string().describe("Source token symbol or address"),
  dstToken: z.string().describe("Destination token symbol or address"),
  amount: AmountSchema,
  slippageBps: SlippageSchema,
});

export const SwapBuildTxInputSchema = z.object({
  chainId: ChainIdSchema,
  srcToken: z.string().describe("Source token symbol or address"),
  dstToken: z.string().describe("Destination token symbol or address"),
  amount: AmountSchema,
  slippageBps: SlippageSchema,
  userAddress: AddressSchema.describe(
    "Wallet address that will sign and send this transaction"
  ),
});
