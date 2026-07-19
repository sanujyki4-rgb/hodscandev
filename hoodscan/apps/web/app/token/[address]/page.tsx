import Link from "next/link";
import { notFound } from "next/navigation";
import { Pagination } from "@/components/Pagination";
import { TokenTransfersTable } from "@/components/TokenTransfersTable";
import { TokenHoldersTable } from "@/components/TokenHoldersTable";
import { ExportCsvButton } from "@/components/ExportCsvButton";
import { ContractIcon } from "@/components/ContractIcon";
import { CopyIconButton } from "@/components/CopyIconButton";
import { ContractCodeSection } from "@/components/ContractCodeSection";
import { TokenAnalytics } from "@/components/TokenAnalytics";
import {
  getTokenDetail,
  getVerification,
  getTokenTransfers,
  getTokenHolders,
  type TokenDetail,
} from "@/lib/api";

export const revalidate = 10;

const LIMIT = 25;
// Holders are listed 100 per page (backend caps page size at 100).
const HOLDERS_LIMIT = 100;

const TABS = ["transfers", "holders", "info", "contract", "analytics"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABEL: Record<Tab, string> = {
  transfers: "Transfers",
  holders: "Holders",
  info: "Info",
  contract: "Contract",
  analytics: "Analytics",
};

export default async function TokenDetailPage({
  params,
  searchParams,
}: {
  params: { address: string };
  searchParams: { tab?: string; page?: string };
}) {
  const address = params.address.toLowerCase();
  const tab: Tab = (TABS as readonly string[]).includes(searchParams.tab ?? "")
    ? (searchParams.tab as Tab)
    : "transfers";
  const page = Math.max(Number(searchParams.page) || 1, 1);
  const pageLimit = tab === "holders" ? HOLDERS_LIMIT : LIMIT;
  const offset = (page - 1) * pageLimit;

  const detail = await getTokenDetail(address);
  if (detail === null) notFound();

  // Token contracts: show a ✓ on the Contract tab when verified.
  const contractVerified =
    (await getVerification(address).catch(() => null))?.verified === true;

  const title = detail.name ?? "Unknown Token";
  const symbol = detail.symbol;

  const transfersData = tab === "transfers" ? await getTokenTransfers(address, LIMIT, offset) : null;
  const holdersData = tab === "holders" ? await getTokenHolders(address, HOLDERS_LIMIT, offset) : null;

  const supplyDisplay =
    detail.totalSupply !== null
      ? `${detail.totalSupply}${symbol ? ` ${symbol}` : ""}`
      : "—";

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <ContractIcon />
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

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <TabLink key={t} address={address} tab={t} active={tab === t}>
            {TAB_LABEL[t]}
            {t === "contract" && contractVerified && (
              <svg viewBox="0 0 20 20" fill="currentColor" className="ml-1 inline-block h-3.5 w-3.5 align-text-top text-lime" aria-label="Verified">
                <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0l-3.5-3.5a1 1 0 111.4-1.4l2.8 2.8 6.8-6.8a1 1 0 011.4 0z" clipRule="evenodd" />
              </svg>
            )}
          </TabLink>
        ))}
      </div>

      {/* Tab content */}
      {tab === "transfers" ? (
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
            <TokenTransfersTable transfers={transfersData.transfers} symbol={symbol} />
            <Pagination
              basePath={`/token/${address}`}
              page={page}
              limit={transfersData.limit}
              total={transfersData.total}
              noun="transfers"
              queryPrefix="tab=transfers&"
            />
          </>
        )
      ) : tab === "holders" ? (
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
              page={page}
              limit={holdersData.limit}
              total={holdersData.total}
              noun="holders"
              queryPrefix="tab=holders&"
            />
          </>
        )
      ) : tab === "info" ? (
        <TokenInfo detail={detail} supplyDisplay={supplyDisplay} />
      ) : tab === "contract" ? (
        <ContractCodeSection address={address} />
      ) : (
        <TokenAnalytics address={address} />
      )}
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

function TabLink({
  address,
  tab,
  active,
  children,
}: {
  address: string;
  tab: Tab;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={`/token/${address}?tab=${tab}`}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
        active ? "border-lime text-ink" : "border-transparent text-muted hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

function ApiError() {
  return (
    <p className="rounded-xl border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
      Couldn&apos;t reach the hoodscan API.
    </p>
  );
}
