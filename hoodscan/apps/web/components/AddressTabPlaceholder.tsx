import type { AddressTabId } from "./AddressTabs";
import { getTabLabel } from "./AddressTabs";

const HINTS: Record<AddressTabId, string> = {
  transactions: "",
  internal:
    "Internal transactions (ETH transferred via contracts) are not indexed yet.",
  "token-erc20":
    "ERC-20 token transfers require event indexing, which is not available yet.",
  nft: "NFT transfers (ERC-721 / ERC-1155) are not indexed yet.",
  contract: "",
  analytics: "Address analytics will appear here once more activity metrics are indexed.",
  assets: "Token and native balances are not tracked by the indexer yet.",
  cards: "Cards is an explorer product surface we have not implemented.",
};

export function AddressTabPlaceholder({ tab }: { tab: AddressTabId }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center">
      <p className="text-sm font-medium text-ink">{getTabLabel(tab)}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">
        {HINTS[tab] || "This tab is not available yet."}
      </p>
      <p className="mt-4 text-xs text-muted">Coming soon · data not indexed</p>
    </div>
  );
}
