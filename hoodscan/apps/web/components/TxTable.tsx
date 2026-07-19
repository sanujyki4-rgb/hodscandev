import Link from "next/link";
import type { TransactionSummary } from "@/lib/api";
import { shortenHash, weiToEth, methodLabel, resolvedTxnFee, TXN_FEE_TOOLTIP, timeAgo, displayAddress } from "@/lib/format";
import { tableRowClass } from "@/lib/tableStyles";
import { TxIcon } from "./icons";
import { EmptyState } from "./EmptyState";
import { ViewAllLink } from "./ViewAllLink";
import { Chip } from "./Chip";

// System txs are identified by txType "0x6a" (Arbitrum-style ArbOS
// internal housekeeping) — same source of truth used by the backend
// controller and L1L2Table. methodLabel() already folds this in, so
// this table doesn't need its own separate check anymore.

/**
 * Font: no `font-mono` (see BlocksTable.tsx for why). "Amount" and
 * "Max fee" are the pure-number columns here, so they're the ones
 * carrying the `.nums` utility (globals.css) — Tx/From/To are
 * hashes/addresses, which are truncated already and don't need
 * figure styling or column alignment.
 */
export function TxTable({
  transactions,
  variant = "compact",
  viewAllHref,
}: {
  transactions: TransactionSummary[];
  /**
   * "compact" (homepage): Tx / From / To / Amount — method + age
   *   stacked as a secondary line under the hash, to fit the narrow
   *   3-up grid.
   * "detailed" (/transactions, block detail page): Tx / Method /
   *   Block / Age / From / To / Amount / Max fee — matches Arbiscan's
   *   transaction list column set and ordering.
   */
  variant?: "compact" | "detailed";
  viewAllHref?: string;
}) {
  if (transactions.length === 0) {
    return <EmptyState message="No transactions to show." />;
  }

  const isDetailed = variant === "detailed";

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="h-10 whitespace-nowrap bg-surface text-[11px] uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Tx</th>
              {isDetailed && <th className="px-4 py-2.5 font-semibold">Method</th>}
              {isDetailed && <th className="px-4 py-2.5 font-semibold">Block</th>}
              {isDetailed && <th className="px-4 py-2.5 font-semibold">Age</th>}
              <th className="px-4 py-2.5 font-semibold">From</th>
              <th className="px-4 py-2.5 font-semibold">To</th>
              <th className={`px-4 py-2.5 font-semibold ${isDetailed ? "text-right" : ""}`}>Amount</th>
              {isDetailed && <th className="px-4 py-2.5 text-right font-semibold">Txn Fee</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {transactions.map((tx, i) => {
              const method = tx.method ?? methodLabel(tx.functionSelector, tx.txType, tx.value);
              // Only the "detailed" (view-all) layout has a Txn Fee column.
              const { value: fee, isActual: isActualFee } = isDetailed
                ? resolvedTxnFee(tx)
                : { value: null, isActual: false };

              return (
                <tr
                  key={tx.hash}
                  className={tableRowClass(i)}
                >
                  {/* Column values: text-sm. Method + Age get their own
                      columns in "detailed"; stay stacked under the hash
                      in "compact" (homepage) to save width. */}
                  <td className="px-4 py-2.5 text-sm">
                    <Link href={`/tx/${tx.hash}`} className="group/link flex items-center gap-2">
                      <TxIcon size={24} className="shrink-0 text-lime" />
                      {isDetailed ? (
                        <span className="text-sm font-medium text-lime group-hover/link:underline">
                          {shortenHash(tx.hash, 3)}
                        </span>
                      ) : (
                        <span className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium text-lime group-hover/link:underline">
                            {shortenHash(tx.hash, 3)}
                          </span>
                          {tx.block && (
                            <span className="text-xs text-muted">{timeAgo(tx.block.timestamp)}</span>
                          )}
                        </span>
                      )}
                    </Link>
                  </td>

                  {isDetailed && (
                    <td className="px-4 py-2.5 text-sm">
                      <Chip>{method}</Chip>
                    </td>
                  )}

                  {isDetailed && (
                    <td className="px-4 py-2.5 text-sm">
                      <Link href={`/block/${tx.blockNumber}`} className="text-lime hover:underline">
                        #{tx.blockNumber}
                      </Link>
                    </td>
                  )}

                  {isDetailed && (
                    <td className="px-4 py-2.5 text-sm text-muted">
                      {tx.block ? timeAgo(tx.block.timestamp) : "—"}
                    </td>
                  )}

                  <td className="px-4 py-2.5 text-sm">
                    <Link href={`/address/${tx.fromAddress}`} title={tx.fromAddress} className="text-sm text-muted hover:text-lime">
                      {displayAddress(tx.fromAddress, tx.fromLabel)}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-sm">
                    {tx.toAddress ? (
                      <Link href={`/address/${tx.toAddress}`} title={tx.toAddress} className="text-sm text-muted hover:text-lime">
                        {displayAddress(tx.toAddress, tx.toLabel)}
                      </Link>
                    ) : (
                      <span className="text-sm text-muted">Contract</span>
                    )}
                  </td>
                  <td className={`nums px-4 py-2.5 text-sm text-ink ${isDetailed ? "text-right" : ""}`}>
                    {weiToEth(tx.value, 4)} ETH
                  </td>
                  {isDetailed && (
                    <td
                      className="nums px-4 py-2.5 text-right text-sm text-muted"
                      title={isActualFee ? TXN_FEE_TOOLTIP.actual : TXN_FEE_TOOLTIP.approx}
                    >
                      {fee !== null ? `${fee} ETH` : "—"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {viewAllHref && <ViewAllLink href={viewAllHref} label="transactions" />}
    </div>
  );
}
