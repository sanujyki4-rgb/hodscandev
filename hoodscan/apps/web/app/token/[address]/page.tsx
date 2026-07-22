import Link from "next/link";
import { notFound } from "next/navigation";
import { Pagination } from "@/components/Pagination";
import { TokenTransfersTable } from "@/components/TokenTransfersTable";
import { TokenHoldersTable } from "@/components/TokenHoldersTable";
import { ExportCsvButton } from "@/components/ExportCsvButton";
import { TokenLogo } from "@/components/TokenLogo";
import { CopyIconButton } from "@/components/CopyIconButton";
import { ContractCodeSection } from "@/components/ContractCodeSection";
import { TokenAnalytics } from "@/components/TokenAnalytics";
import { HashTabs, type HashTab } from "@/components/HashTabs";
import {
  getTokenDetail,
  getVerification,
  getTokenTransfers,
  getTokenHolders,
  tokenLogoSrc,
  type TokenDetail,
} from "@/lib/api";

export const revalidate = 10;

const LIMIT = 25;
// Holders are listed 100 per page (backend caps page size at 100).
const HOLDERS_LIMIT = 100;

// Arbiscan-style URL hash slug per tab. The active tab lives in the URL
// fragment (e.g. /token/0x..#transactions), never in a ?tab= query param.
const TAB_HASH = {
  transfers: "transactions",
  holders: "holders",
  info: "info",
  contract: "code",
  analytics: "analytics",
  cards: "cards",
} as const;

export default async function TokenDetailPage({
  params,
  searchParams,
}: {
  params: { address: string };
  // Transfers and holders paginate independently (tp / hp) so both keep their
  // own page while the active tab is tracked purely by the URL hash.
  searchParams: { tp?: string; hp?: string };
}) {
  const address = params.address.toLowerCase();
  const transfersPage = Math.max(Number(searchParams.tp) || 1, 1);
  const holdersPage = Math.max(Number(searchParams.hp) || 1, 1);
  const transfersOffset = (transfersPage - 1) * LIMIT;
  const holdersOffset = (holdersPage - 1) * HOLDERS_LIMIT;

  const detail = await getTokenDetail(address);
  if (detail === null) notFound();

  // Token contracts: show a ✓ on the Contract tab when verified.
  const contractVerified =
    (await getVerification(address).catch(() => null))?.verified === true;

  const title = detail.name ?? "Unknown Token";
  const symbol = detail.symbol;

  // Both datasets are loaded up-front because the tab is chosen client-side
  // (from the URL hash), so the server can't know which one is visible.
  const [transfersData, holdersData] = await Promise.all([
    getTokenTransfers(address, LIMIT, transfersOffset),
    getTokenHolders(address, HOLDERS_LIMIT, holdersOffset),
  ]);

  const supplyDisplay =
    detail.totalSupply !== null
      ? `${detail.totalSupply}${symbol ? ` ${symbol}` : ""}`
      : "—";

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

  const tabs: HashTab[] = [
    {
      id: "transfers",
      hash: TAB_HASH.transfers,
      label: "Transfers",
      content:
        transfersData === null ? (
          <ApiError />
        ) : (
          <>
            <div className="flex justify-end">
              <ExportCsvButton
                filename={`transfers-${address}.csv`}
                headers={["Tx Hash", "Timestamp", "From", "To", "Amount", "Symbol"]}
                rows={transfersData.transfers.map((t) => [
                  t.txHash,
                  new Date(t.timestamp).toISOString(),
                  t.fromAddress,
                  t.toAddress,
                  t.amount ?? `${t.rawAmount} (raw)`,
                  symbol ?? "",
                ])}
              />
            </div>
            <TokenTransfersTable transfers={transfersData.transfers} symbol={symbol} decimals={detail.decimals} />
            <Pagination
              basePath={`/token/${address}`}
              page={transfersPage}
              limit={transfersData.limit}
              total={transfersData.total}
              noun="transfers"
              pageParam="tp"
              hashSuffix={`#${TAB_HASH.transfers}`}
            />
          </>
        ),
    },
    {
      id: "holders",
      hash: TAB_HASH.holders,
      label: "Holders",
      content:
        holdersData === null ? (
          <ApiError />
        ) : (
          <>
            <div className="flex justify-end">
              <ExportCsvButton
                filename={`holders-${address}.csv`}
                headers={["Rank", "Address", "Balance", "Percentage", "Symbol"]}
                rows={holdersData.holders.map((h) => [
                  String(h.rank),
                  h.address,
                  h.balance ?? `${h.rawBalance} (raw)`,
                  h.percentage !== null && h.percentage !== undefined
                    ? `${h.percentage}%`
                    : "",
                  symbol ?? "",
                ])}
              />
            </div>
            <TokenHoldersTable holders={holdersData.holders} symbol={symbol} />
            <Pagination
              basePath={`/token/${address}`}
              page={holdersPage}
              limit={holdersData.limit}
              total={holdersData.total}
              noun="holders"
              pageParam="hp"
              hashSuffix={`#${TAB_HASH.holders}`}
            />
          </>
        ),
    },
    {
      id: "info",
      hash: TAB_HASH.info,
      label: "Info",
      content: <TokenInfo detail={detail} supplyDisplay={supplyDisplay} />,
    },
    {
      id: "contract",
      hash: TAB_HASH.contract,
      label: "Contract",
      badge: verifiedBadge,
      content: <ContractCodeSection address={address} />,
    },
    {
      id: "analytics",
      hash: TAB_HASH.analytics,
      label: "Analytics",
      content: <TokenAnalytics address={address} />,
    },
    {
      id: "cards",
      hash: TAB_HASH.cards,
      label: "Cards",
      content: (
        <TokenSurfacePlaceholder
          title="Cards"
          hint="Cards is an explorer product surface we have not implemented."
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <TokenLogo address={detail.tokenAddress} symbol={symbol} logoUrl={tokenLogoSrc(detail.logo)} size={32} />
          <h1 className="font-display text-2xl font-bold tracking-tight">
            {title}
            {symbol ? (
              <span className="ml-2 text-lg font-medium text-muted">({symbol})</span>
            ) : null}
          </h1>
        </div>
        <div className="flex items-center gap-2 font-mono text-sm text-muted">
          <Link href={`/address/${detail.tokenAddress}`} className="text-lime hover:underline">
            {detail.tokenAddress}
          </Link>
          <CopyIconButton value={detail.tokenAddress} />
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Total supply" value={supplyDisplay} />
        <SummaryCard label="Decimals" value={detail.decimals !== null ? String(detail.decimals) : "—"} />
        <SummaryCard label="Transfers" value={detail.transferCount.toLocaleString("en-US")} />
        <SummaryCard label="Holders" value={detail.holderCount.toLocaleString("en-US")} />
      </div>

      {/* Hash-driven tabs (Arbiscan-style #transactions URLs) */}
      <HashTabs tabs={tabs} />
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 break-all font-mono text-sm text-ink">{value}</div>
    </div>
  );
}

function TokenInfo({ detail, supplyDisplay }: { detail: TokenDetail; supplyDisplay: string }) {
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: "Name", value: detail.name ?? "—" },
    { label: "Symbol", value: detail.symbol ?? "—" },
    {
      label: "Contract",
      value: (
        <span className="flex items-center gap-2">
          <Link href={`/address/${detail.tokenAddress}`} className="break-all text-lime hover:underline">
            {detail.tokenAddress}
          </Link>
          <CopyIconButton value={detail.tokenAddress} />
        </span>
      ),
    },
    { label: "Decimals", value: detail.decimals !== null ? String(detail.decimals) : "—" },
    { label: "Total supply", value: supplyDisplay },
    { label: "Holders", value: detail.holderCount.toLocaleString("en-US") },
    { label: "Total transfers", value: detail.transferCount.toLocaleString("en-US") },
    { label: "Type", value: "ERC-20" },
  ];

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="divide-y divide-border">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-[180px_1fr] sm:gap-4">
            <div className="text-sm text-muted">{r.label}</div>
            <div className="break-all font-mono text-sm text-ink">{r.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TokenSurfacePlaceholder({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">{hint}</p>
      <p className="mt-4 text-xs text-muted">Coming soon · not available</p>
    </div>
  );
}

function ApiError() {
  return (
    <p className="rounded-xl border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
      Couldn&apos;t reach the hoodscan API.
    </p>
  );
}
