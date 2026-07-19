/**
 * Shared EVM address helpers. Keeping the validation regex in one place
 * avoids the same `/^0x[0-9a-fA-F]{40}$/` literal drifting across every
 * controller.
 */

/** Matches a 0x-prefixed 20-byte hex address (case-insensitive). */
export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** True when `value` is a syntactically valid 0x EVM address. */
export function isValidAddress(value: string | null | undefined): boolean {
  return typeof value === "string" && ADDRESS_RE.test(value);
}
