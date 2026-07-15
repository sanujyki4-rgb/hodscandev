import { notFound } from "next/navigation";
import Link from "next/link";
import { getTransactionByHash } from "@/lib/api";
import { weiToEth, timeAgo } from "@/lib/format";

export const revalidate = 15;

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-2.5 last:border-b-0">
      <span className="shrink-0 text-sm text-muted">{label}</span>
      <span className="break-all text-right font-mono text-sm text-ink">{value}</span>
    </div>
  );
}

export default async function TransactionPage({
  params,
}: {
  params: { hash: string };
}) {
  const tx = await getTransactionByHash(params.hash);

  if (!tx) notFound();

  const isSystemTx = tx.txType === "0x6a";
  const isL1ToL2 = tx.txType === "0x69";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Transaction
        </h1>
        <div className="flex items-center gap-2">
          {isSystemTx && (
            <span className="rounded-full bg-muted/15 px-2.5 py-1 text-xs font-medium text-muted">
              System tx
            </span>
          )}
          {isL1ToL2 && (
            <span className="rounded-full bg-lime/15 px-2.5 py-1 text-xs font-medium text-lime">
              L1↔L2 Message
            </span>
          )}
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              tx.block.isFinalized
                ? "bg-lime/15 text-lime"
                : "bg-muted/15 text-muted"
            }`}
          >
            {tx.block.isFinalized ? "Finalized" : "Pending"}
          </span>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface px-4">
        <DetailRow label="Hash" value={tx.hash} />
        <DetailRow
          label="Block"
          value={
            <Link href={`/block/${tx.blockNumber}`} className="text-lime hover:underline">
              #{tx.blockNumber}
            </Link>
          }
        />
        <DetailRow label="Timestamp" value={timeAgo(tx.block.timestamp)} />
        <DetailRow label="Type" value={tx.txTypeLabel} />
        {isL1ToL2 && (
          <DetailRow
            label="L1 Transaction"
            value={
              tx.l1TxHash ? (
                <a
                  href={`https://etherscan.io/tx/${tx.l1TxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-lime hover:underline"
                >
                  {tx.l1TxHash}
                </a>
              ) : (
                <span className="italic text-muted">Not indexed yet</span>
              )
            }
          />
        )}
        <DetailRow
          label="From"
          value={
            <Link href={`/address/${tx.fromAddress}`} className="text-lime hover:underline">
              {tx.fromAddress}
            </Link>
          }
        />
        <DetailRow
          label="To"
          value={
            tx.toAddress ? (
              <Link href={`/address/${tx.toAddress}`} className="text-lime hover:underline">
                {tx.toAddress}
              </Link>
            ) : (
              <span className="text-muted">Contract creation</span>
            )
          }
        />
        <DetailRow label="Value" value={`${weiToEth(tx.value)} ETH`} />
        <DetailRow label="Gas" value={tx.gas} />
        {tx.gasPrice && <DetailRow label="Gas price" value={tx.gasPrice} />}
        {tx.maxFeePerGas && <DetailRow label="Max fee per gas" value={tx.maxFeePerGas} />}
        {tx.functionSelector && (
          <DetailRow label="Function selector" value={tx.functionSelector} />
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
          Input data
        </h2>
        <pre className="max-h-64 overflow-auto rounded-xl border border-border bg-surface px-4 py-3 font-mono text-xs text-muted">
          {tx.input}
        </pre>
      </div>
    </div>
  );
}
