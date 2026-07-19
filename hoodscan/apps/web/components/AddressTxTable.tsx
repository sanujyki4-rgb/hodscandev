import Link from "next/link";
import type { TransactionSummary } from "@/lib/api";
import {
  displayAddress,
  weiToEth,
  timeAgo,
  methodLabel,
  resolvedTxnFee,
  TXN_FEE_TOOLTIP,
  shortenHash,
} from "@/lib/format";
import { tableRowClass } from "@/lib/tableStyles";
import { EmptyState } from "./EmptyState";
import { Badge } from "./Badge";
import { Chip } from "./Chip";
import { CopyIconButton } from "./CopyIconButton";
import { ContractIcon } from "./ContractIcon";

/** From/To cell: hash (or friendly label) + copy; profile address not clickable. */
function PartyAddress({
  value,
  isSelf,
  label,
  isContract,
}: {
  value: string;
  isSelf: boolean;
  label?: string | null;
  isContract?: boolean | null;
}) {
  const display = displayAddress(value, label);
  return (
    <span className="inline-flex items-center gap-1">
      {isContract ? <ContractIcon /> : null}
      {isSelf ? (
        <span className="cursor-text font-medium text-ink" title={value}>
          {display}
        </span>
      ) : (
        <Link
          href={`/address/${value}`}
          className="text-muted hover:text-lime"
          title={value}
        >
          {display}
        </Link>
      )}
      <CopyIconButton value={value} label="Copy address" />
    </span>
  );
}

/**
 * Address-context transaction table (Arbiscan-style Transactions tab).
 * Font: no `font-mono` (see BlocksTable.tsx for why). Block/Amount/
 * Txn Fee/Age are the pure-number columns and carry `.nums`
 * (globals.css); hashes/addresses don't need it.
 */
export function AddressTxTable({
  address,
  transactions,
}: {
  address: string;
  transactions: TransactionSummary[];
}) {
  const addr = address.toLowerCase();

  if (transactions.length === 0) {
    return <EmptyState message="No transactions found for this address in the indexed range." />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="h-10 whitespace-nowrap bg-surface text-[11px] uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Txn Hash</th>
              <th className="px-4 py-2.5 font-semibold">Method</th>
              <th className="px-4 py-2.5 font-semibold">Block</th>
              <th className="px-4 py-2.5 font-semibold">Age</th>
              <th className="px-4 py-2.5 font-semibold">From</th>
              <th className="px-3 py-2.5 font-semibold" />
              <th className="px-4 py-2.5 font-semibold">To</th>
              <th className="px-4 py-2.5 font-semibold">Amount</th>
              <th className="px-4 py-2.5 font-semibold">Txn Fee</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {transactions.map((tx, i) => {
              const from = tx.fromAddress.toLowerCase();
              const to = (tx.toAddress ?? "").toLowerCase();
              const isOut = from === addr;
              const isIn = to === addr;
              const direction =
                isOut && isIn ? "SELF" : isOut ? "OUT" : isIn ? "IN" : "—";
              const { value: fee, isActual: isActualFee } = resolvedTxnFee(tx);

              return (
                <tr key={tx.hash} className={tableRowClass(i)}>
                  <td className="px-4 py-2.5 text-sm">
                    <span className="inline-flex items-center gap-1">
                      <Link
                        href={`/tx/${tx.hash}`}
                        className="font-medium text-lime hover:underline"
                      >
                        {shortenHash(tx.hash, 4)}
                      </Link>
                      <CopyIconButton value={tx.hash} label="Copy txn hash" />
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-sm">
                    <Chip>{tx.method ?? methodLabel(tx.functionSelector, tx.txType)}</Chip>
                  </td>
                  <td className="nums px-4 py-2.5 text-sm">
                    <Link
                      href={`/block/${tx.blockNumber}`}
                      className="font-medium text-lime hover:underline"
                    >
                      {tx.blockNumber}
                    </Link>
                  </td>
                  <td className="nums px-4 py-2.5 text-sm text-muted">
                    {tx.block?.timestamp ? timeAgo(tx.block.timestamp) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-sm">
                    <PartyAddress value={tx.fromAddress} isSelf={isOut} label={tx.fromLabel} isContract={tx.fromIsContract} />
                  </td>
                  <td className="px-1 py-2.5 text-center">
                    <Badge
                      tone={direction === "IN" ? "positive" : direction === "OUT" ? "warning" : "muted"}
                      className="inline-block min-w-[2.5rem] rounded px-1.5 py-0.5 text-center tracking-wide"
                    >
                      {direction}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-sm">
                    {!tx.toAddress ? (
                      <span className="text-sm text-muted">Contract Creation</span>
                    ) : (
                      <PartyAddress value={tx.toAddress} isSelf={isIn} label={tx.toLabel} isContract={tx.toIsContract} />
                    )}
                  </td>
                  <td className="nums px-4 py-2.5 text-sm text-ink">
                    {weiToEth(tx.value, 6)} ETH
                  </td>
                  <td
                    className="nums px-4 py-2.5 text-sm text-muted"
                    title={isActualFee ? TXN_FEE_TOOLTIP.actual : TXN_FEE_TOOLTIP.approx}
                  >
                    {fee !== null ? `${fee} ETH` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
