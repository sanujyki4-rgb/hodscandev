import Link from "next/link";
import { getTransactionUserOperations } from "@/lib/api";
import { shortenHash } from "@/lib/format";

/**
 * User Operations (ERC-4337) section for the transaction detail page.
 *
 * Async server component: fetches GET /transactions/:hash/user-operations,
 * which decodes any EntryPoint `UserOperationEvent` logs the indexer already
 * stored for this tx. A normal (non-Account-Abstraction) transaction has no
 * such logs, so this section renders NOTHING (returns null) and stays out of
 * the way — it only appears for bundler/AA transactions. Never throws.
 */
export async function UserOperationsSection({ hash }: { hash: string }) {
  const data = await getTransactionUserOperations(hash);
  if (!data || data.userOperations.length === 0) return null;

  const version = data.userOperations[0]?.entryPointVersion ?? null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
          User Operations (ERC-4337)
        </h2>
        {version && (
          <span className="rounded bg-border/40 px-1.5 py-0.5 font-mono text-xs text-muted">
            EntryPoint {version}
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-2 font-medium">User Op Hash</th>
              <th className="px-4 py-2 font-medium">Sender</th>
              <th className="px-4 py-2 font-medium">Paymaster</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 text-right font-medium">Gas Used</th>
            </tr>
          </thead>
          <tbody>
            {data.userOperations.map((op) => (
              <tr
                key={`${op.userOpHash ?? "op"}-${op.logIndex}`}
                className="border-b border-border last:border-b-0"
              >
                <td className="px-4 py-2 font-mono text-xs">
                  {op.userOpHash ? (
                    <span title={op.userOpHash}>{shortenHash(op.userOpHash, 6)}</span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  {op.sender ? (
                    <Link
                      href={`/address/${op.sender}`}
                      title={op.sender}
                      className="font-mono text-xs text-lime hover:underline"
                    >
                      {shortenHash(op.sender, 6)}
                    </Link>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  {op.paymaster ? (
                    <Link
                      href={`/address/${op.paymaster}`}
                      title={op.paymaster}
                      className="font-mono text-xs text-lime hover:underline"
                    >
                      {shortenHash(op.paymaster, 6)}
                    </Link>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  {op.success ? (
                    <span className="rounded-md bg-green-500/10 px-1.5 py-0.5 text-xs font-medium text-green-500">
                      Success
                    </span>
                  ) : (
                    <span className="rounded-md bg-red-500/10 px-1.5 py-0.5 text-xs font-medium text-red-500">
                      Failed
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs text-muted">
                  {op.actualGasUsed}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
