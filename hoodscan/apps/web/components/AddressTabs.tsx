import Link from "next/link";

export type AddressTabId =
  | "transactions"
  | "internal"
  | "token-erc20"
  | "nft"
  | "contract"
  | "analytics"
  | "assets"
  | "cards";

type TabDef = { id: AddressTabId; label: string; available: boolean };

/**
 * Master tab definitions. `available` marks whether hoodscan has real
 * data for that tab today (others render an honest placeholder).
 */
const TAB_DEFS: Record<AddressTabId, TabDef> = {
  transactions: { id: "transactions", label: "Transactions", available: true },
  internal: { id: "internal", label: "Internal Transactions", available: false },
  "token-erc20": { id: "token-erc20", label: "Token Transfers (ERC-20)", available: true },
  nft: { id: "nft", label: "NFT Transfers", available: true },
  contract: { id: "contract", label: "Contract", available: true },
  analytics: { id: "analytics", label: "Analytics", available: false },
  assets: { id: "assets", label: "Assets", available: false },
  cards: { id: "cards", label: "Cards", available: false },
};

// Arbiscan-style ordering. The Contract tab appears ONLY for smart-
// contract addresses; wallets (EOAs) never show it.
const EOA_TAB_IDS: AddressTabId[] = [
  "transactions",
  "internal",
  "token-erc20",
  "nft",
  "analytics",
  "assets",
  "cards",
];
const CONTRACT_TAB_IDS: AddressTabId[] = [
  "transactions",
  "internal",
  "token-erc20",
  "nft",
  "contract",
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

export function parseAddressTab(
  raw: string | undefined,
  isContract: boolean,
  hasNftActivity = false
): AddressTabId {
  const id = (raw ?? "transactions") as AddressTabId;
  const allowed = getAddressTabs(isContract, hasNftActivity).some((t) => t.id === id);
  return allowed ? id : "transactions";
}

export function AddressTabs({
  address,
  active,
  isContract,
  hasNftActivity,
  contractVerified = false,
}: {
  address: string;
  active: AddressTabId;
  isContract: boolean;
  hasNftActivity: boolean;
  contractVerified?: boolean;
}) {
  const tabs = getAddressTabs(isContract, hasNftActivity);
  return (
    <div className="overflow-x-auto border-b border-border">
      <nav className="flex min-w-max gap-0" aria-label="Address activity">
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          const href =
            tab.id === "transactions"
              ? `/address/${address}`
              : `/address/${address}?tab=${tab.id}`;

          return (
            <Link
              key={tab.id}
              href={href}
              className={`relative px-3.5 py-2.5 text-sm font-medium transition sm:px-4 ${
                isActive ? "text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {tab.label}
              {tab.id === "contract" && contractVerified && (
                <svg
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="ml-1 inline-block h-3.5 w-3.5 align-text-top text-lime"
                  aria-label="Verified"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0l-3.5-3.5a1 1 0 111.4-1.4l2.8 2.8 6.8-6.8a1 1 0 011.4 0z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
              {!tab.available && (
                <span className="ml-1 text-[10px] font-normal text-muted/70">·</span>
              )}
              {isActive && (
                <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-lime-bright" />
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
