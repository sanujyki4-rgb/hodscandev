import Link from "next/link";
import type { TokenTransferRow } from "@/lib/api";
import { timeAgo, shortTxHash, displayAddr, shortAddr, shortTokenAmount } from "@/lib/format";
import { ContractIcon } from "@/components/ContractIcon";
import { EmptyState } from "./EmptyState";
import { Badge } from "./Badge";

/**
 * Renders the address page's "Token Transfers (ERC-20)" tab: one row per
 * decoded Transfer event, with the amount already scaled by the token's
 * on-chain decimals and an IN/OUT chip relative to the viewed address.
 */

export function AddressTokenTransfersTable({
  transfers,
}: {
  transfers: TokenTransferRow[];
}) {
  if (transfers.length === 0) {
    return <EmptyState message="No ERC-20 token transfers found for this address yet." />;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-max text-left text-sm">
        <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-2.5 font-medium">Tx Hash</th>
            <th className="px-4 py-2.5 font-medium">Age</th>
            <th className="px-4 py-2.5 font-medium">From</th>
            <th className="px-4 py-2.5 font-medium"></th>
            <th className="px-4 py-2.5 font-medium">To</th>
            <th className="px-4 py-2.5 font-medium">Amount</th>
            <th className="px-4 py-2.5 font-medium">Token</th>
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
              <td className="px-4 py-2.5">
                {t.direction === "out" ? (
                  <Badge tone="muted" className="rounded-md px-1.5 py-0.5 text-xs">
                    OUT
                  </Badge>
                ) : t.direction === "in" ? (
                  <Badge tone="positive" className="rounded-md px-1.5 py-0.5 text-xs">
                    IN
                  </Badge>
                ) : null}
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
                {shortTokenAmount(t.amount, t.rawAmount, 4, t.decimals ?? 18)}
              </td>
              <td className="px-4 py-2.5 font-mono">
                <Link
                  href={`/address/${t.tokenAddress}`}
                  className="text-lime hover:underline"
                  title={t.tokenAddress}
                >
                  {t.symbol ?? t.name ?? shortAddr(t.tokenAddress)}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
