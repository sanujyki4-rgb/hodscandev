import Link from "next/link";
import type { AddressEventRow } from "@/lib/api";
import { timeAgo, shortTxHash, shortenHash } from "@/lib/format";
import { EmptyState } from "./EmptyState";
import { Badge } from "./Badge";

/**
 * Renders the address/contract page's "Events" tab: one row per event log
 * emitted by the contract, with a friendly event name (when the topic0 is a
 * known signature), the indexed topics, and the raw data. Mirrors the other
 * address tables (px-4 py-2.5, EmptyState) so the tabs stay consistent.
 */
export function AddressEventsTable({ rows }: { rows: AddressEventRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState message="No events found for this address yet. Events fill in as the indexer processes blocks (or run the logs backfill for older history)." />
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-max text-left text-sm">
        <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-2.5 font-medium">Txn Hash</th>
            <th className="px-4 py-2.5 font-medium">Event</th>
            <th className="px-4 py-2.5 font-medium">Block</th>
            <th className="px-4 py-2.5 font-medium">Age</th>
            <th className="px-4 py-2.5 font-medium">Topics</th>
            <th className="px-4 py-2.5 font-medium">Data</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr
              key={`${e.txHash}-${e.logIndex}`}
              className="border-b border-border align-top last:border-b-0"
            >
              <td className="px-4 py-2.5 font-mono">
                <Link
                  href={`/tx/${e.txHash}`}
                  className="text-lime hover:underline"
                  title={e.txHash}
                >
                  {shortTxHash(e.txHash)}
                </Link>
              </td>
              <td className="px-4 py-2.5">
                {e.eventName ? (
                  <Badge tone="positive" className="rounded-md px-1.5 py-0.5 text-xs">
                    {e.eventName}
                  </Badge>
                ) : e.topic0 ? (
                  <span
                    className="font-mono text-xs text-muted"
                    title={e.topic0}
                  >
                    {shortenHash(e.topic0, 5)}
                  </span>
                ) : (
                  <span className="text-xs text-muted">Anonymous</span>
                )}
              </td>
              <td className="px-4 py-2.5 font-mono">
                <Link
                  href={`/block/${e.blockNumber}`}
                  className="text-lime hover:underline"
                >
                  {e.blockNumber}
                </Link>
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-muted">
                {timeAgo(e.timestamp)}
              </td>
              <td className="px-4 py-2.5">
                <div className="flex flex-col gap-0.5">
                  {e.topics.map((t, i) => (
                    <span
                      key={i}
                      className="font-mono text-xs text-muted"
                      title={t}
                    >
                      <span className="text-ink">[{i}]</span> {shortenHash(t, 6)}
                    </span>
                  ))}
                </div>
              </td>
              <td className="max-w-md px-4 py-2.5">
                {e.decoded && e.decoded.params.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    <span
                      className="break-all font-mono text-[11px] text-muted"
                      title={e.decoded.signature}
                    >
                      {e.decoded.signature}
                    </span>
                    {e.decoded.params.map((p, i) => (
                      <span
                        key={i}
                        className="break-all font-mono text-xs"
                        title={p.value}
                      >
                        <span className="text-ink">{p.name}</span>
                        <span className="text-muted"> ({p.type})</span>: {p.value}
                      </span>
                    ))}
                    <details className="text-xs text-muted">
                      <summary className="cursor-pointer select-none">
                        Raw data
                      </summary>
                      <span className="mt-1 block break-all font-mono text-[11px] text-muted">
                        {e.data === "0x" || e.data === "" ? "—" : e.data}
                      </span>
                    </details>
                  </div>
                ) : (
                  <span
                    className="block truncate font-mono text-xs text-muted"
                    title={e.data}
                  >
                    {e.data === "0x" || e.data === "" ? "—" : e.data}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
