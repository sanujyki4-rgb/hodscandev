import { notFound } from "next/navigation";
import { getTransactionsByAddress, getVerification, getAddressOverview } from "@/lib/api";
import { weiToEth } from "@/lib/format";
import { getAddressTabs, type AddressTabId } from "@/components/AddressTabs";
import { AddressTxTable } from "@/components/AddressTxTable";
import { AddressTokenTransfersSection } from "@/components/AddressTokenTransfersSection";
import { AddressNftTransfersSection } from "@/components/AddressNftTransfersSection";
import { AddressInternalTxSection } from "@/components/AddressInternalTxSection";
import { AddressOtherTxSection } from "@/components/AddressOtherTxSection";
import { AddressTokenHoldingsSection } from "@/components/AddressTokenHoldingsSection";
import { AddressEventsSection } from "@/components/AddressEventsSection";
import { ContractCodeSection } from "@/components/ContractCodeSection";
import { ContractIcon } from "@/components/ContractIcon";
import { AddressTabPlaceholder } from "@/components/AddressTabPlaceholder";
import { Pagination } from "@/components/Pagination";
import { ResultCount } from "@/components/ResultCount";
import { HashTabs, type HashTab } from "@/components/HashTabs";

export const revalidate = 5;

const LIMIT = 25;

// Arbiscan-style URL hash slug per address tab. The active tab lives in the
// URL fragment (e.g. /address/0x..#transactions), never a ?tab= query param.
const TAB_HASH: Record<AddressTabId, string> = {
  transactions: "transactions",
  internal: "internaltx",
  "token-erc20": "tokentxns",
  nft: "tokentxnsErc721",
  other: "othertxns",
  contract: "code",
  events: "events",
  analytics: "analytics",
  assets: "assets",
  cards: "cards",
};

export default async function AddressPage({
  params,
  searchParams,
}: {
  params: { addr: string };
  // Each paginated tab keeps its own page param (txp / erc20p / nftp) so the
  // active tab is tracked purely by the URL hash.
  searchParams: { txp?: string; erc20p?: string; nftp?: string; intp?: string; otherp?: string; evp?: string; assetp?: string };
}) {
  const txPage = Math.max(Number(searchParams.txp) || 1, 1);
  const erc20Page = Math.max(Number(searchParams.erc20p) || 1, 1);
  const nftPage = Math.max(Number(searchParams.nftp) || 1, 1);
  const internalPage = Math.max(Number(searchParams.intp) || 1, 1);
  const otherPage = Math.max(Number(searchParams.otherp) || 1, 1);
  const eventsPage = Math.max(Number(searchParams.evp) || 1, 1);
  const assetsPage = Math.max(Number(searchParams.assetp) || 1, 1);
  const txOffset = (txPage - 1) * LIMIT;

  // Loads the tx summary (also drives isContract / hasNftActivity / tx count).
  const data = await getTransactionsByAddress(params.addr, LIMIT, txOffset);

  if (!data) notFound();

  const address = data.address.startsWith("0x") ? data.address : params.addr;
  const isContract = data.isContract ?? false;
  const hasNftActivity = data.hasNftActivity ?? false;

  // Address header balance (native gas token). Best-effort: null if the
  // overview endpoint is unreachable or the node didn't return a balance.
  const overview = await getAddressOverview(address);
  const nativeBalanceEth =
    overview?.nativeBalance != null ? weiToEth(overview.nativeBalance) : null;

  // For contracts, check verification status so the Contract tab can show a ✓.
  const contractVerified = isContract
    ? (await getVerification(address).catch(() => null))?.verified === true
    : false;

  const verifiedBadge = contractVerified ? (
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
  ) : null;

  const contentFor = (id: AddressTabId): React.ReactNode => {
    switch (id) {
      case "transactions":
        return (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <ResultCount total={data.total} noun="transaction" />
            </div>
            <AddressTxTable address={address} transactions={data.transactions} />
            {data.total > 0 && (
              <Pagination
                basePath={`/address/${address}`}
                page={txPage}
                limit={LIMIT}
                total={data.total}
                pageParam="txp"
                hashSuffix={`#${TAB_HASH.transactions}`}
              />
            )}
          </div>
        );
      case "token-erc20":
        return (
          <AddressTokenTransfersSection
            address={address}
            page={erc20Page}
            pageParam="erc20p"
            hashSuffix={`#${TAB_HASH["token-erc20"]}`}
          />
        );
      case "nft":
        return (
          <AddressNftTransfersSection
            address={address}
            page={nftPage}
            pageParam="nftp"
            hashSuffix={`#${TAB_HASH.nft}`}
          />
        );
      case "contract":
        return <ContractCodeSection address={address} />;
      case "internal":
        return (
          <AddressInternalTxSection
            address={address}
            page={internalPage}
            pageParam="intp"
            hashSuffix={`#${TAB_HASH.internal}`}
          />
        );
      case "other":
        return (
          <AddressOtherTxSection
            address={address}
            page={otherPage}
            pageParam="otherp"
            hashSuffix={`#${TAB_HASH.other}`}
          />
        );
      case "events":
        return (
          <AddressEventsSection
            address={address}
            page={eventsPage}
            pageParam="evp"
            hashSuffix={`#${TAB_HASH.events}`}
          />
        );
      case "assets":
        return (
          <AddressTokenHoldingsSection
            address={address}
            page={assetsPage}
            pageParam="assetp"
            hashSuffix={`#${TAB_HASH.assets}`}
          />
        );
      default:
        return <AddressTabPlaceholder tab={id} />;
    }
  };

  const tabs: HashTab[] = getAddressTabs(isContract, hasNftActivity).map((t) => ({
    id: t.id,
    hash: TAB_HASH[t.id],
    label: t.label,
    badge: t.id === "contract" ? verifiedBadge : undefined,
    content: contentFor(t.id),
  }));

  return (
    <div className="flex flex-col gap-6">
      {/* Minimal header — overview cards later */}
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight">
          {data.isContract ? <ContractIcon address={address} isToken={data.isToken} /> : null}
          {data.isContract ? "Contract" : "Address"}
        </h1>
        <p className="break-all font-mono text-sm text-muted">{address}</p>
        <p className="mt-1 text-sm">
          <span className="text-muted">Balance:</span>{" "}
          <span className="font-medium">
            {nativeBalanceEth != null ? `${nativeBalanceEth} ETH` : "—"}
          </span>
        </p>
      </div>

      {/* Hash-driven tabs (Arbiscan-style #transactions URLs) */}
      <HashTabs tabs={tabs} />
    </div>
  );
}
