import Link from "next/link";
import type { TokenHolding } from "@/lib/api";
import { shortAddr, shortTokenAmount } from "@/lib/format";
import { tokenLogoSrc } from "@/lib/api";
import { EmptyState } from "./EmptyState";
import { TokenLogo } from "./TokenLogo";

/**
 * ERC-20 token holdings (portfolio) for an address, ranked by balance.
 * Each row links to the token detail page (/token/<address>).
 */
export function AddressTokenHoldingsTable({ holdings }: { holdings: TokenHolding[] }) {
  if (holdings.length === 0) {
    return <EmptyState message="No token holdings found." />;
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
            <th className="px-4 py-2.5 font-medium">Balance</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((h, i) => (
            <tr key={h.tokenAddress} className="border-b border-border last:border-b-0">
              <td className="px-4 py-2.5 text-muted">{i + 1}</td>
              <td className="px-4 py-2.5">
                <Link
                  href={`/token/${h.tokenAddress}`}
                  className="flex items-center gap-2 font-medium text-lime hover:underline"
                >
                  <TokenLogo address={h.tokenAddress} symbol={h.symbol} logoUrl={tokenLogoSrc(h.logo)} size={20} />
                  {h.name || "Unknown Token"}
                </Link>
              </td>
              <td className="px-4 py-2.5 text-ink">{h.symbol || "—"}</td>
              <td className="px-4 py-2.5 font-mono">
                <Link
                  href={`/token/${h.tokenAddress}`}
                  className="text-lime hover:underline"
                  title={h.tokenAddress}
                >
                  {shortAddr(h.tokenAddress)}
                </Link>
              </td>
              <td className="px-4 py-2.5 font-mono text-ink" title={h.balance ?? undefined}>
                {shortTokenAmount(h.balance, h.rawBalance, 4, h.decimals)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
