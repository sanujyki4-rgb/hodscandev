import { formatUnits } from "viem";

/**
 * Convert a Prisma Decimal (anything with toFixed) to a base-unit bigint
 * WITHOUT exponential notation. Decimal.toString() yields "4e+21" for large
 * values and BigInt("4e+21") throws; toFixed(0) gives the full integer.
 */
export function decimalToBigInt(amount: { toFixed(digits: number): string }): bigint {
  return BigInt(amount.toFixed(0));
}

/**
 * Scale a raw uint256 base-unit token amount by `decimals` and add
 * thousands separators to the integer part (e.g. 1250500000n with 6
 * decimals -> "1,250.5"). Returns null when decimals is unknown or the
 * value can't be formatted, so callers can fall back to the raw value.
 */
export function formatTokenAmount(
  raw: bigint,
  decimals: number | null
): string | null {
  if (decimals === null) return null;
  try {
    const formatted = formatUnits(raw, decimals);
    const [intPart, fracPart] = formatted.split(".");
    const withCommas = (intPart ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return fracPart ? `${withCommas}.${fracPart}` : withCommas;
  } catch {
    return null;
  }
}
