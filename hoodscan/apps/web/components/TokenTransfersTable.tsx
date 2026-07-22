import Link from "next/link";
import type { TokenTransferListRow } from "@/lib/api";
import { timeAgo, shortTxHash, displayAddr, shortTokenAmount } from "@/lib/format";
import { ContractIcon } from "@/components/ContractIcon";
import { EmptyState } from "./EmptyState";

/**
 * Token detail page — "Transfers" tab. One row per Transfer event of a
 * single token (newest first). Amount is already scaled by the token's
 * on-chain decimals server-side.
 */
export function TokenTransfersTable({
  transfers,
  symbol,
  decimals,
}: {
  transfers: TokenTransferListRow[];
  symbol: string | null;
  decimals?: number | null;
}) {
  if (transfers.length === 0) {
    return <EmptyState message="No transfers found for this token yet." />;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-max text-left text-sm">
        <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-2.5 font-medium">Tx Hash</th>
            <th className="px-4 py-2.5 font-medium">Age</th>
            <th className="px-4 py-2.5 font-medium">From</th>
            <th className="px-4 py-2.5 font-medium">To</th>
            <th className="px-4 py-2.5 font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {transfers.map((t) => (
            <tr
              key={`${t.txHash}-${t.logIndex}`}
              className="border-b border-border last:border-b-0"
            >
              <td className="px-4 py-2.5 font-mono">
                <Link
                  href={`/tx/${t.txHash}`}
                  className="text-lime hover:underline"
                  title={t.txHash}
                >
                  {shortTxHash(t.txHash)}
                </Link>
              </td>
              <td className="px-4 py-2.5 text-muted">{timeAgo(t.timestamp)}</td>
              <td className="px-4 py-2.5 font-mono">
                {t.fromIsContract ? <ContractIcon address={t.fromAddress} isToken={t.fromIsToken} /> : null}
                <Link
                  href={`/address/${t.fromAddress}`}
                  className="text-lime hover:underline"
                  title={t.fromAddress}
                >
                  {displayAddr(t.fromAddress, t.fromLabel)}
                </Link>
              </td>
              <td className="px-4 py-2.5 font-mono">
                {t.toIsContract ? <ContractIcon address={t.toAddress} isToken={t.toIsToken} /> : null}
                <Link
                  href={`/address/${t.toAddress}`}
                  className="text-lime hover:underline"
                  title={t.toAddress}
                >
                  {displayAddr(t.toAddress, t.toLabel)}
                </Link>
              </td>
              <td
                className="px-4 py-2.5 font-mono text-ink"
                title={t.amount ?? `${t.rawAmount} (raw)`}
              >
                {shortTokenAmount(t.amount, t.rawAmount, 4, decimals ?? 18)}
                {symbol ? ` ${symbol}` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
