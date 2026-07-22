import Link from "next/link";
import type { TokenHolderRow } from "@/lib/api";
import { displayAddr, shortTokenAmount, formatPercent } from "@/lib/format";
import { ContractIcon } from "@/components/ContractIcon";
import { EmptyState } from "./EmptyState";

/**
 * Token detail page — "Holders" tab. Balances are derived from net
 * transfer flow (incoming minus outgoing) over all indexed transfers of
 * this token, ranked by balance. This is bounded by what the indexer has
 * seen, so it's an approximation until historical transfers are fully
 * backfilled.
 */
export function TokenHoldersTable({
  holders,
  symbol,
}: {
  holders: TokenHolderRow[];
  symbol: string | null;
}) {
  if (holders.length === 0) {
    return <EmptyState message="No holders found for this token yet." />;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-max text-left text-sm">
        <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-2.5 font-medium">Rank</th>
            <th className="px-4 py-2.5 font-medium">Address</th>
            <th className="px-4 py-2.5 font-medium">Balance</th>
            <th className="px-4 py-2.5 font-medium">Percentage</th>
          </tr>
        </thead>
        <tbody>
          {holders.map((h) => (
            <tr
              key={h.address}
              className="border-b border-border last:border-b-0"
            >
              <td className="px-4 py-2.5 text-muted">{h.rank}</td>
              <td className="px-4 py-2.5 font-mono">
                {h.isContract ? <ContractIcon address={h.address} isToken={h.isToken} /> : null}
                <Link
                  href={`/address/${h.address}`}
                  className="text-lime hover:underline"
                  title={h.address}
                >
                  {displayAddr(h.address, h.label)}
                </Link>
              </td>
              <td
                className="px-4 py-2.5 font-mono text-ink"
                title={h.balance ?? `${h.rawBalance} (raw)`}
              >
                {shortTokenAmount(h.balance, h.rawBalance)}
                {symbol ? ` ${symbol}` : ""}
              </td>
              <td className="px-4 py-2.5 font-mono text-muted">
                {formatPercent(h.percentage)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
