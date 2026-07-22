import Link from "next/link";
import { getInternalTransactions } from "@/lib/api";
import { ContractIcon } from "@/components/ContractIcon";
import { displayAddr } from "@/lib/format";

/**
 * Internal Transactions section for the transaction detail page.
 *
 * Async server component: fetches GET /transactions/:hash/internal, which
 * lazily traces the tx on demand (traces are on-demand, never bulk-indexed).
 * Renders one of three honest states:
 *   - a table of internal calls when the trace decoded some,
 *   - a "no internal transactions" note when the tx made no sub-calls,
 *   - a "trace unavailable" note when the provider couldn't trace it.
 * Never throws: if the API is unreachable it renders nothing so the rest of
 * the transaction page is unaffected.
 */
export async function InternalTxSection({ hash }: { hash: string }) {
  const data = await getInternalTransactions(hash);
  if (!data) return null;

  const rows = data.internalTransactions;

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
        Internal Transactions
      </h2>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface px-4 py-6 text-sm text-muted">
          {data.traceError
            ? `Trace unavailable — ${data.traceError}`
            : "This transaction produced no internal transactions (no contract sub-calls or ETH value transfers)."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">From</th>
                <th className="px-4 py-2 font-medium">To</th>
                <th className="px-4 py-2 text-right font-medium">Value (ETH)</th>
                <th className="px-4 py-2 text-right font-medium">Gas used</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.traceAddress}
                  className="border-b border-border last:border-b-0"
                >
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="rounded bg-border/40 px-1.5 py-0.5 font-mono text-xs uppercase text-ink">
                        {r.callType}
                      </span>
                      {r.error && (
                        <span
                          title={r.error}
                          className="text-xs font-medium text-red-500"
                        >
                          failed
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center gap-1">
                      {r.fromIsContract ? <ContractIcon address={r.fromAddress} isToken={r.fromIsToken} /> : null}
                      <Link
                        href={`/address/${r.fromAddress}`}
                        title={r.fromAddress}
                        className="font-mono text-xs text-lime hover:underline"
                      >
                        {displayAddr(r.fromAddress, r.fromLabel)}
                      </Link>
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {r.toAddress ? (
                      <span className="inline-flex items-center gap-1">
                        {r.toIsContract ? <ContractIcon address={r.toAddress} isToken={r.toIsToken} /> : null}
                        <Link
                          href={`/address/${r.toAddress}`}
                          title={r.toAddress}
                          className="font-mono text-xs text-lime hover:underline"
                        >
                          {displayAddr(r.toAddress, r.toLabel)}
                        </Link>
                      </span>
                    ) : (
                      <span className="text-muted">Contract creation</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    {r.value}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-muted">
                    {r.gasUsed ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {data.total > rows.length && (
            <p className="px-4 py-2 text-xs text-muted">
              Showing {rows.length} of {data.total} internal transactions.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
