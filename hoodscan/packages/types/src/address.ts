/**
 * Curated friendly-name labels for well-known contract / EOA addresses,
 * Etherscan/Arbiscan style. Keys MUST be lowercase — lookups lowercase
 * the input before matching.
 *
 * Only add entries that are VERIFIABLE (e.g. the canonical zero/burn
 * addresses, or token contracts confirmed on-chain). Do NOT add guessed
 * or unverified labels — a wrong label is worse than none. The map is
 * intentionally extendable.
 */
export const ADDRESS_LABELS: Record<string, string> = {
  "0x0000000000000000000000000000000000000000": "Null: 0x0000…0000",
  "0x000000000000000000000000000000000000dead": "Null: Burn",
};

/**
 * Returns the friendly label for an address, or null when the address is
 * unknown (or nullish). Input is lowercased before lookup so callers don't
 * have to normalize casing themselves.
 */
export function getAddressLabel(address: string | null | undefined): string | null {
  if (!address) return null;
  return ADDRESS_LABELS[address.toLowerCase()] ?? null;
}
