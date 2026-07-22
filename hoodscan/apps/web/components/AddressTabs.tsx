export type AddressTabId =
  | "transactions"
  | "internal"
  | "token-erc20"
  | "nft"
  | "other"
  | "contract"
  | "events"
  | "analytics"
  | "assets"
  | "cards";

type TabDef = { id: AddressTabId; label: string; available: boolean };

/**
 * Address / contract page tab definitions.
 *
 * `available` marks whether hoodscan has real data for that tab today (others
 * render an honest placeholder). The tab strip itself is rendered by
 * <HashTabs> using Arbiscan-style #hash URLs (e.g. /address/0x..#transactions);
 * this module only supplies the ordered, type-safe tab defs.
 */
const TAB_DEFS: Record<AddressTabId, TabDef> = {
  transactions: { id: "transactions", label: "Transactions", available: true },
  internal: { id: "internal", label: "Internal Transactions", available: true },
  "token-erc20": { id: "token-erc20", label: "Token Transfers (ERC-20)", available: true },
  nft: { id: "nft", label: "NFT Transfers", available: true },
  other: { id: "other", label: "Other Transactions", available: true },
  contract: { id: "contract", label: "Contract", available: true },
  events: { id: "events", label: "Events", available: true },
  analytics: { id: "analytics", label: "Analytics", available: false },
  assets: { id: "assets", label: "Token Holdings", available: true },
  cards: { id: "cards", label: "Cards", available: false },
};

// Arbiscan-style ordering. The Contract/Events tabs appear ONLY for smart-
// contract addresses; wallets (EOAs) never show them.
const EOA_TAB_IDS: AddressTabId[] = [
  "transactions",
  "internal",
  "token-erc20",
  "nft",
  "other",
  "analytics",
  "assets",
  "cards",
];
const CONTRACT_TAB_IDS: AddressTabId[] = [
  "transactions",
  "internal",
  "token-erc20",
  "nft",
  "other",
  "contract",
  "events",
  "analytics",
  "assets",
  "cards",
];

export function getAddressTabs(isContract: boolean, hasNftActivity = false): TabDef[] {
  const ids = isContract ? CONTRACT_TAB_IDS : EOA_TAB_IDS;
  return ids.filter((id) => id !== "nft" || hasNftActivity).map((id) => TAB_DEFS[id]);
}

export function getTabLabel(id: AddressTabId): string {
  return TAB_DEFS[id]?.label ?? id;
}
