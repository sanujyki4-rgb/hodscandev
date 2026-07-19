import Link from "next/link";
import type { TokenListItem } from "@/lib/api";
import { shortAddr } from "@/lib/format";
import { EmptyState } from "./EmptyState";

/**
 * ERC-20 token list — ranked by transfer count. Each row links to the
 * token detail page (/token/<address>).
 */
export function TokensTable({ tokens }: { tokens: TokenListItem[] }) {
  if (tokens.length === 0) {
    return <EmptyState message="No tokens found yet." />;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-max text-left text-sm">
        <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-2.5 font-medium">#</th>
            <th className="px-4 py-2.5 font-medium">Token</th>
            <th className="px-4 py-2.5 font-medium">Symbol</th>
            <th className="px-4 py-2.5 font-medium">Contract</th>
            <th className="px-4 py-2.5 font-medium">Transfers</th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((t, i) => (
            <tr
              key={t.tokenAddress}
              className="border-b border-border last:border-b-0"
            >
              <td className="px-4 py-2.5 text-muted">{i + 1}</td>
              <td className="px-4 py-2.5">
                <Link
                  href={`/token/${t.tokenAddress}`}
                  className="font-medium text-lime hover:underline"
                >
                  {t.name ?? "Unknown Token"}
                </Link>
              </td>
              <td className="px-4 py-2.5 text-ink">{t.symbol ?? "—"}</td>
              <td className="px-4 py-2.5 font-mono">
                <Link
                  href={`/token/${t.tokenAddress}`}
                  className="text-lime hover:underline"
                  title={t.tokenAddress}
                >
                  {shortAddr(t.tokenAddress)}
                </Link>
              </td>
              <td className="px-4 py-2.5 font-mono text-ink">
                {t.transferCount.toLocaleString("en-US")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
