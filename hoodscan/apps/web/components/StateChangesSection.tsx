import Link from "next/link";
import { getTransactionStateDiff } from "@/lib/api";
import { weiToEth } from "@/lib/format";

/**
 * State Changes ("Advanced TxInfo") section for the transaction detail page.
 *
 * Async server component: fetches GET /transactions/:hash/state-diff, which
 * traces the tx on demand with a prestateTracer (diffMode) and decodes the
 * per-account balance/nonce/storage deltas. Renders one of three honest states:
 *   - a table of per-account changes when the trace decoded some,
 *   - a "no state changes" note when nothing changed,
 *   - a "trace unavailable" note when the provider couldn't trace it.
 * Never throws: if the API is unreachable it renders nothing so the rest of the
 * transaction page is unaffected.
 */
export async function StateChangesSection({ hash }: { hash: string }) {
  const data = await getTransactionStateDiff(hash);
  if (!data) return null;

  const rows = data.stateChanges;

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
        State Changes
      </h2>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface px-4 py-6 text-sm text-muted">
          {data.unavailable
            ? "State trace unavailable — the RPC provider could not trace this transaction."
            : "No state changes were recorded for this transaction."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2 font-medium">Address</th>
                <th className="px-4 py-2 text-right font-medium">
                  Balance Before (ETH)
                </th>
                <th className="px-4 py-2 text-right font-medium">
                  Balance After (ETH)
                </th>
                <th className="px-4 py-2 text-right font-medium">Nonce</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const nonceChanged = r.nonceBefore !== r.nonceAfter;
                return (
                  <tr
                    key={r.address}
                    className="border-b border-border align-top last:border-b-0"
                  >
                    <td className="px-4 py-2">
                      <div className="flex flex-col gap-1">
                        <Link
                          href={`/address/${r.address}`}
                          title={r.address}
                          className="font-mono text-xs text-lime hover:underline"
                        >
                          {r.address}
                        </Link>
                        {r.storageChanges.length > 0 && (
                          <details className="text-xs text-muted">
                            <summary className="cursor-pointer select-none">
                              {r.storageChanges.length} storage slot
                              {r.storageChanges.length === 1 ? "" : "s"} changed
                            </summary>
                            <div className="mt-1 flex flex-col gap-1.5">
                              {r.storageChanges.map((s) => (
                                <div
                                  key={s.slot}
                                  className="flex flex-col gap-0.5 border-l border-border pl-2"
                                >
                                  <span className="break-all font-mono text-[11px] text-muted">
                                    <span className="text-ink">slot</span> {s.slot}
                                  </span>
                                  <span className="break-all font-mono text-[11px] text-muted">
                                    {s.before} → {s.after}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs">
                      {weiToEth(r.balanceBefore)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs">
                      {weiToEth(r.balanceAfter)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-muted">
                      {nonceChanged
                        ? `${r.nonceBefore} → ${r.nonceAfter}`
                        : r.nonceBefore}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
