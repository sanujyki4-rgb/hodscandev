/**
 * Attach friendly `fromLabel` / `toLabel` fields to a transaction row,
 * derived from the curated ADDRESS_LABELS map in @hoodscan/types. Mirrors
 * Etherscan/Arbiscan's practice of showing known-contract names in the
 * From/To columns. Labels are null when the address isn't known.
 */
import { getAddressLabel } from "@hoodscan/types";

export function withAddressLabels<
  T extends { fromAddress?: string | null; toAddress?: string | null }
>(tx: T): T & { fromLabel: string | null; toLabel: string | null } {
  return {
    ...tx,
    fromLabel: getAddressLabel(tx.fromAddress),
    toLabel: getAddressLabel(tx.toAddress),
  };
}
