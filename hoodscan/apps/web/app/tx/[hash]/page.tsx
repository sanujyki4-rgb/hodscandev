import { notFound } from "next/navigation";
import Link from "next/link";
import { getTransactionByHash } from "@/lib/api";
import { weiToEth, timeAgo, methodLabel, shortTokenAmount } from "@/lib/format";
import { isSystemTxType, isL1ToL2TxType } from "@hoodscan/types";
import { ContractIcon } from "@/components/ContractIcon";
import { DetailRow } from "@/components/DetailRow";
import { Badge } from "@/components/Badge";
import { Chip } from "@/components/Chip";

export const revalidate = 15;

export default async function TransactionPage({
  params,
}: {
  params: { hash: string };
}) {
  const tx = await getTransactionByHash(params.hash);

  if (!tx) notFound();

  const isSystemTx = isSystemTxType(tx.txType);
  const isL1ToL2 = isL1ToL2TxType(tx.txType);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Transaction
        </h1>
        <div className="flex items-center gap-2">
          {isSystemTx && (
            <Badge tone="muted" className="rounded-full px-2.5 py-1 text-xs">
              System tx
            </Badge>
          )}
          {isL1ToL2 && (
            <Badge tone="positive" className="rounded-full px-2.5 py-1 text-xs">
              L1↔L2 Message
            </Badge>
          )}
          <Badge tone={tx.block.isFinalized ? "positive" : "muted"} className="rounded-full px-2.5 py-1 text-xs">
            {tx.block.isFinalized ? "Finalized" : "Pending"}
          </Badge>
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
        <DetailRow
          label="Method"
          value={<Chip>{tx.method ?? methodLabel(tx.functionSelector, tx.txType)}</Chip>}
        />
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
            <span className="inline-flex items-center gap-1">
              {tx.fromIsContract ? <ContractIcon /> : null}
              <Link href={`/address/${tx.fromAddress}`} title={tx.fromAddress} className="text-lime hover:underline">
                {tx.fromLabel ?? tx.fromAddress}
              </Link>
            </span>
          }
        />
        <DetailRow
          label="To"
          value={
            tx.toAddress ? (
              <span className="inline-flex items-center gap-1">
                {tx.toIsContract ? <ContractIcon /> : null}
                <Link href={`/address/${tx.toAddress}`} title={tx.toAddress} className="text-lime hover:underline">
                  {tx.toLabel ?? tx.toAddress}
                </Link>
              </span>
            ) : (
              <span className="text-muted">Contract creation</span>
            )
          }
        />
        <DetailRow label="Amount" value={`${weiToEth(tx.value)} ETH`} />
        <DetailRow label="Gas" value={tx.gas} />
        {tx.gasPrice && <DetailRow label="Gas price" value={tx.gasPrice} />}
        {tx.maxFeePerGas && <DetailRow label="Max fee per gas" value={tx.maxFeePerGas} />}
        {tx.functionSelector && (
          <DetailRow label="Function selector" value={tx.functionSelector} />
        )}
      </div>

      {tx.tokenTransfer && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
            Token Transfer
          </h2>
          <div className="rounded-xl border border-border bg-surface px-4">
            <DetailRow
              label="Asset"
              value={
                <Link
                  href={`/address/${tx.tokenTransfer.tokenAddress}`}
                  title={tx.tokenTransfer.tokenAddress}
                  className="text-lime hover:underline"
                >
                  {tx.tokenTransfer.symbol ??
                    tx.tokenTransfer.name ??
                    tx.tokenTransfer.tokenAddress}
                </Link>
              }
            />
            <DetailRow
              label="Amount"
              value={
                <span title={tx.tokenTransfer.amount ?? `${tx.tokenTransfer.rawAmount} (raw)`}>
                  {shortTokenAmount(tx.tokenTransfer.amount, tx.tokenTransfer.rawAmount)}
                  {tx.tokenTransfer.symbol ? ` ${tx.tokenTransfer.symbol}` : ""}
                </span>
              }
            />
            {tx.tokenTransfer.from && (
              <DetailRow
                label="From"
                value={
                  <Link
                    href={`/address/${tx.tokenTransfer.from}`}
                    className="text-lime hover:underline"
                  >
                    {tx.tokenTransfer.from}
                  </Link>
                }
              />
            )}
            <DetailRow
              label="To"
              value={
                <Link
                  href={`/address/${tx.tokenTransfer.to}`}
                  className="text-lime hover:underline"
                >
                  {tx.tokenTransfer.to}
                </Link>
              }
            />
          </div>
        </div>
      )}

      {tx.decodedInput && tx.decodedInput.args.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
            Decoded Input
          </h2>
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-4 py-3">
            <p className="break-all font-mono text-xs text-muted">
              {tx.decodedInput.signature}
            </p>
            <div className="flex flex-col gap-2">
              {tx.decodedInput.args.map((arg, i) => (
                <div
                  key={i}
                  className="flex flex-col gap-1 border-b border-border pb-2 last:border-b-0 last:pb-0"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-ink">{arg.name}</span>
                    <span className="text-xs text-muted">{arg.type}</span>
                  </div>
                  <span className="break-all font-mono text-sm text-ink">
                    {arg.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

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
