/** Format a raw token amount (bigint string) to a human-readable decimal string */
export function formatTokenAmount(raw: string, decimals: number): string {
  if (decimals === 0) return raw;

  const isNegative = raw.startsWith("-");
  const abs = isNegative ? raw.slice(1) : raw;
  const padded = abs.padStart(decimals + 1, "0");
  const intPart = padded.slice(0, padded.length - decimals);
  const fracPart = padded.slice(padded.length - decimals).replace(/0+$/, "");

  const formatted = fracPart ? `${intPart}.${fracPart}` : intPart;
  return isNegative ? `-${formatted}` : formatted;
}

/** Convert a human-readable decimal amount to raw smallest-unit string */
export function parseTokenAmount(amount: string, decimals: number): string {
  const [intPart, fracPart = ""] = amount.split(".");
  const paddedFrac = fracPart.padEnd(decimals, "0").slice(0, decimals);
  const raw = intPart + paddedFrac;
  return raw.replace(/^0+/, "") || "0";
}

/** Truncate an address for display: 0x1234...abcd */
export function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/** Format a USD value to a clean string */
export function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
