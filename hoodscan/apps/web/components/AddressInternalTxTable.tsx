import Link from "next/link";
import type { AddressInternalTxRow } from "@/lib/api";
import { timeAgo, shortTxHash, displayAddr } from "@/lib/format";
import { ContractIcon } from "@/components/ContractIcon";
import { EmptyState } from "./EmptyState";
import { Badge } from "./Badge";

/**
 * Renders the address page's "Internal Txns" tab: one row per internal
 * transaction (trace sub-call / value transfer) where the address is the
 * sender or recipient, with an IN/OUT chip relative to the viewed address.
 * Mirrors AddressTokenTransfersTable so the address tabs stay consistent.
 */
export function AddressInternalTxTable({
  rows,
}: {
  rows: AddressInternalTxRow[];
}) {
  if (rows.length === 0) {
    return (
      <EmptyState message="No internal transactions found for this address yet. They fill in as the indexer traces blocks." />
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-max text-left text-sm">
        <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-2.5 font-medium">Tx Hash</th>
            <th className="px-4 py-2.5 font-medium">Type</th>
            <th className="px-4 py-2.5 font-medium">Block</th>
            <th className="px-4 py-2.5 font-medium">Age</th>
            <th className="px-4 py-2.5 font-medium">From</th>
            <th className="px-4 py-2.5 font-medium"></th>
            <th className="px-4 py-2.5 font-medium">To</th>
            <th className="px-4 py-2.5 font-medium">Value (ETH)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${r.txHash}-${r.traceAddress}`}
              className="border-b border-border last:border-b-0"
            >
              <td className="px-4 py-2.5 font-mono">
                <Link
                  href={`/tx/${r.txHash}`}
                  className="text-lime hover:underline"
                  title={r.txHash}
                >
                  {shortTxHash(r.txHash)}
                </Link>
              </td>
              <td className="px-4 py-2.5">
                <span className="inline-flex items-center gap-1.5">
                  <Badge tone="muted" className="rounded-md px-1.5 py-0.5 text-xs">
                    {r.callType}
                  </Badge>
                  {r.error ? (
                    <span title={r.error} className="text-xs font-medium text-danger">
                      failed
                    </span>
                  ) : null}
                </span>
              </td>
              <td className="px-4 py-2.5 font-mono">
                <Link
                  href={`/block/${r.blockNumber}`}
                  className="text-lime hover:underline"
                >
                  {r.blockNumber}
                </Link>
              </td>
              <td className="px-4 py-2.5 text-muted">{timeAgo(r.timestamp)}</td>
              <td className="px-4 py-2.5 font-mono">
                {r.fromIsContract ? <ContractIcon address={r.fromAddress} isToken={r.fromIsToken} /> : null}
                <Link
                  href={`/address/${r.fromAddress}`}
                  className="text-lime hover:underline"
                  title={r.fromAddress}
                >
                  {displayAddr(r.fromAddress, r.fromLabel)}
                </Link>
              </td>
              <td className="px-4 py-2.5">
                {r.direction === "out" ? (
                  <Badge tone="muted" className="rounded-md px-1.5 py-0.5 text-xs">
                    OUT
                  </Badge>
                ) : r.direction === "in" ? (
                  <Badge tone="positive" className="rounded-md px-1.5 py-0.5 text-xs">
                    IN
                  </Badge>
                ) : null}
              </td>
              <td className="px-4 py-2.5 font-mono">
                {r.toAddress ? (
                  <>
                    {r.toIsContract ? <ContractIcon address={r.toAddress} isToken={r.toIsToken} /> : null}
                    <Link
                      href={`/address/${r.toAddress}`}
                      className="text-lime hover:underline"
                      title={r.toAddress}
                    >
                      {displayAddr(r.toAddress, r.toLabel)}
                    </Link>
                  </>
                ) : (
                  <span className="text-muted">Contract creation</span>
                )}
              </td>
              <td
                className="px-4 py-2.5 font-mono text-ink"
                title={`${r.rawValue} wei`}
              >
                {r.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
