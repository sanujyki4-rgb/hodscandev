import Link from "next/link";
import type { NftTransferRow } from "@/lib/api";
import { timeAgo, shortTxHash, displayAddr, shortAddr } from "@/lib/format";
import { ContractIcon } from "@/components/ContractIcon";
import { EmptyState } from "./EmptyState";
import { Badge } from "./Badge";

/**
 * Renders the address page's "NFT Transfers" tab: one row per decoded
 * ERC-721 / ERC-1155 transfer, with an IN/OUT chip relative to the viewed
 * address, the token id, and (for ERC-1155) the transferred quantity.
 */
function shortTokenId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

export function AddressNftTransfersTable({
  transfers,
}: {
  transfers: NftTransferRow[];
}) {
  if (transfers.length === 0) {
    return <EmptyState message="No NFT transfers found for this address yet." />;
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
            <th className="px-4 py-2.5 font-medium">Token ID</th>
            <th className="px-4 py-2.5 font-medium">Qty</th>
            <th className="px-4 py-2.5 font-medium">Collection</th>
          </tr>
        </thead>
        <tbody>
          {transfers.map((t) => (
            <tr
              key={`${t.txHash}-${t.logIndex}-${t.batchIndex}`}
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
              <td className="px-4 py-2.5 font-mono text-ink" title={t.tokenId}>
                #{shortTokenId(t.tokenId)}
              </td>
              <td className="px-4 py-2.5 font-mono text-ink">{t.amount}</td>
              <td className="px-4 py-2.5 font-mono">
                <span className="flex items-center gap-1.5">
                  <Link
                    href={`/address/${t.tokenAddress}`}
                    className="text-lime hover:underline"
                    title={t.tokenAddress}
                  >
                    {t.tokenSymbol ?? t.tokenName ?? shortAddr(t.tokenAddress)}
                  </Link>
                  <span className="rounded bg-muted/15 px-1 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                    {t.standard === "erc1155" ? "1155" : "721"}
                  </span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
