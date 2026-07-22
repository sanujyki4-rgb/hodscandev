import type { AddressTabId } from "./AddressTabs";
import { getTabLabel } from "./AddressTabs";

const HINTS: Record<AddressTabId, string> = {
  transactions: "",
  internal:
    "Address-level internal transactions aren't indexed (traces are on-demand only). Open any transaction's detail page to see its internal transactions.",
  "token-erc20":
    "ERC-20 token transfers require event indexing, which is not available yet.",
  nft: "NFT transfers (ERC-721 / ERC-1155) are not indexed yet.",
  other:
    "Other transaction types (e.g. bridge / L1-to-L2 messages) aren't indexed separately yet.",
  contract: "",
  events: "Contract event logs aren't indexed yet.",
  analytics: "Address analytics will appear here once more activity metrics are indexed.",
  assets: "Token and native balances are not tracked by the indexer yet.",
  cards: "Cards is an explorer product surface we have not implemented.",
};

export function AddressTabPlaceholder({ tab }: { tab: AddressTabId }) {
  // The `internal` tab isn't "coming soon" — the data exists, just per
  // transaction (traces are on-demand, not indexed per address), so give it
  // an accurate footer instead of the generic not-indexed one.
  const footer =
    tab === "internal"
      ? "Available per transaction · open a transaction to view"
      : "Coming soon · data not indexed";

  return (
    <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center">
      <p className="text-sm font-medium text-ink">{getTabLabel(tab)}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">
        {HINTS[tab] || "This tab is not available yet."}
      </p>
      <p className="mt-4 text-xs text-muted">{footer}</p>
    </div>
  );
}
