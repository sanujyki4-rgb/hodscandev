import Link from "next/link";
import type { L1ToL2MessageSummary } from "@/lib/api";
import { shortenHash, timeAgo } from "@/lib/format";
import { tableRowClass } from "@/lib/tableStyles";
import { LayersIcon } from "./icons";
import { EmptyState } from "./EmptyState";
import { ViewAllLink } from "./ViewAllLink";
import { Badge } from "./Badge";

/**
 * Dedicated table for L1->L2 messages (Bridge contract retryable
 * tickets on Ethereum L1) — mirrors Arbiscan's txsDeposits layout.
 *
 * Rows are L1ToL2Message-shaped, NOT Transaction-shaped — a message
 * can exist here with status "initiated" (l2TxHash still null)
 * before its retryable ticket has landed on Robinhood Chain at all.
 * The homepage panel only ever receives "relayed" rows (filtered
 * server-side in the API controller, matching Arbiscan's own
 * homepage), so "Pending Confirmation" only shows up on the full
 * "view all" page.
 *
 * Two layouts:
 * - compact (default): 3 columns (L1 Block / L1 Tx / L2 Tx), each
 *   with a secondary line — same visual language as BlocksTable/
 *   TxTable, sized for the homepage's narrow 3-up grid.
 * - detailed (`variant="detailed"`, used on the standalone "view
 *   all" page, which has room to spare): 6 separate columns, one
 *   per field, matching Arbiscan's txsDeposits exactly — Block No /
 *   Queue Index / L1 Tx / L1 Tx Origin / L2 Tx / Age.
 *
 * Font: no `font-mono` (see BlocksTable.tsx for why) — plain number
 * cells (block numbers, queue index) use the `.nums` utility
 * (globals.css) on the body font instead; hashes/addresses are
 * truncated already and don't carry it, same convention as
 * BlocksTable/TxTable.
 *
 * Weight convention (applies across BlocksTable/TxTable/L1L2Table/
 * AddressTxTable): any text-lime link is a column's primary
 * identifying value and gets font-medium; muted secondary references
 * (addresses shown as "from X", age, queue index) stay unweighted.
 */
export function L1L2Table({
  messages,
  viewAllHref,
  variant = "compact",
}: {
  messages: L1ToL2MessageSummary[];
  viewAllHref?: string;
  variant?: "compact" | "detailed";
}) {
  if (messages.length === 0) {
    return <EmptyState message="No L1↔L2 messages indexed yet." />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="overflow-x-auto">
        <table className={`w-full text-left text-sm ${variant === "detailed" ? "table-fixed" : ""}`}>
          <thead className="h-10 whitespace-nowrap bg-surface text-[11px] uppercase tracking-wider text-muted">
            {variant === "detailed" ? (
              <tr>
                <th className="w-[13%] px-4 py-2.5 font-semibold">Block No</th>
                <th className="w-[9%] px-4 py-2.5 font-semibold">Queue Index</th>
                <th className="w-[19%] px-4 py-2.5 font-semibold">L2 Tx</th>
                <th className="w-[8%] px-4 py-2.5 font-semibold">Age</th>
                <th className="w-[12%] px-4 py-2.5 font-semibold">L1 Tx</th>
                <th className="w-[11%] px-4 py-2.5 font-semibold">L1 Tx Origin</th>
                <th className="w-[13%] px-4 py-2.5 font-semibold">L2 Block</th>
                <th className="w-[11%] px-4 py-2.5 font-semibold">Status</th>
              </tr>
            ) : (
              <tr>
                <th className="px-4 py-2.5 font-semibold">L1 Block</th>
                <th className="px-4 py-2.5 font-semibold">L1 Tx</th>
                <th className="px-4 py-2.5 font-semibold">L2 Tx</th>
              </tr>
            )}
          </thead>
          <tbody className="divide-y divide-border">
            {messages.map((msg, i) => {
              const age = timeAgo(msg.l2Block?.timestamp ?? msg.originTimestamp);
              const rowClass = tableRowClass(i);

              // View-all (detailed): all column values including Age + Queue = text-sm.
              // Homepage (compact): Age + Queue stay text-xs; primary values text-sm.
              if (variant === "detailed") {
                return (
                  <tr key={msg.id} className={rowClass}>
                    <td className="px-4 py-2.5 text-sm">
                      <a
                        href={`https://etherscan.io/block/${msg.originBlockNumber}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="nums flex items-center gap-2 text-sm font-medium text-lime hover:underline"
                      >
                        <LayersIcon size={24} className="hidden shrink-0 text-lime sm:inline-block" />
                        {msg.originBlockNumber}
                      </a>
                    </td>
                    <td className="nums px-4 py-2.5 text-sm text-muted">#{msg.id}</td>
                    <td className="px-4 py-2.5 text-sm">
                      {msg.l2TxHash ? (
                        <Link href={`/tx/${msg.l2TxHash}`} className="text-sm font-medium text-lime hover:underline">
                          {shortenHash(msg.l2TxHash, 3)}
                        </Link>
                      ) : (
                        <span className="text-sm font-medium italic text-warning/80">
                          Pending Confirmation
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-muted">{age}</td>
                    <td className="px-4 py-2.5 text-sm">
                      <a
                        href={`https://etherscan.io/tx/${msg.originTxHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-lime hover:underline"
                      >
                        {shortenHash(msg.originTxHash, 3)}
                      </a>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-muted">
                      <a
                        href={`https://etherscan.io/address/${msg.originAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-lime hover:underline"
                        title="View L1 address on Etherscan"
                      >
                        {shortenHash(msg.originAddress, 3)}
                      </a>
                    </td>
                    <td className="nums px-4 py-2.5 text-sm text-muted">
                      {msg.l2Block ? msg.l2Block.number : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-sm">
                      <Badge tone={msg.status === "relayed" ? "positive" : "warning"}>
                        {msg.status === "relayed" ? "Relayed" : "Pending"}
                      </Badge>
                    </td>
                  </tr>
                );
              }

              return (
                <tr key={msg.id} className={rowClass}>
                  {/* L1 Block + Queue Index — queue is not a main column value → text-xs */}
                  <td className="px-4 py-2.5 text-sm">
                    <a
                      href={`https://etherscan.io/block/${msg.originBlockNumber}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group/link flex items-center gap-2"
                    >
                      <LayersIcon size={24} className="hidden shrink-0 text-lime sm:inline-block" />
                      <span className="flex flex-col gap-0.5">
                        <span className="nums text-sm font-medium text-lime group-hover/link:underline">
                          {msg.originBlockNumber}
                        </span>
                        <span className="nums text-xs text-muted">Queue #{msg.id}</span>
                      </span>
                    </a>
                  </td>

                  {/* L1 Tx + origin address (address is column meta → text-sm) */}
                  <td className="px-4 py-2.5 text-sm">
                    <a
                      href={`https://etherscan.io/tx/${msg.originTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-lime hover:underline"
                    >
                      {shortenHash(msg.originTxHash, 3)}
                    </a>
                    <span className="mt-0.5 block text-xs text-muted">
                      from{" "}
                      <a
                        href={`https://etherscan.io/address/${msg.originAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-lime hover:underline"
                        title="View L1 address on Etherscan"
                      >
                        {shortenHash(msg.originAddress, 3)}
                      </a>
                    </span>
                  </td>

                  {/* L2 Tx + age (age is time → text-xs) */}
                  <td className="px-4 py-2.5 text-sm">
                    {msg.l2TxHash ? (
                      <Link href={`/tx/${msg.l2TxHash}`} className="text-sm font-medium text-lime hover:underline">
                        {shortenHash(msg.l2TxHash, 3)}
                      </Link>
                    ) : (
                      <span className="text-sm font-medium italic text-warning/80">
                        Pending Confirmation
                      </span>
                    )}
                    <span className="mt-0.5 block text-xs text-muted">{age}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {viewAllHref && <ViewAllLink href={viewAllHref} label="L1↔L2 messages" />}
    </div>
  );
}
