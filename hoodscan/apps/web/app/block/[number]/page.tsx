import { notFound } from "next/navigation";
import { getBlockByNumber } from "@/lib/api";
import { TxTable } from "@/components/TxTable";
import { DetailRow } from "@/components/DetailRow";
import { Badge } from "@/components/Badge";
import { timeAgo, formatGasUsed, formatGasLimit, formatGwei } from "@/lib/format";

export const revalidate = 30;

export default async function BlockPage({
  params,
}: {
  params: { number: string };
}) {
  const block = await getBlockByNumber(params.number);

  if (!block) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Block #{block.number}
        </h1>
        <Badge tone={block.isFinalized ? "positive" : "muted"} className="rounded-full px-2.5 py-1 text-xs">
          {block.isFinalized ? "Finalized" : "Pending"}
        </Badge>
      </div>

      <div className="rounded-xl border border-border bg-surface px-4">
        <DetailRow label="Timestamp" value={`${timeAgo(block.timestamp)}`} />
        <DetailRow label="Hash" value={block.hash} />
        <DetailRow label="Parent hash" value={block.parentHash} />
        <DetailRow label="Transactions" value={block.txCount} />
        <DetailRow label="Gas used" value={formatGasUsed(block.gasUsed, block.gasLimit)} />
        <DetailRow label="Gas limit" value={formatGasLimit(block.gasLimit)} />
        <DetailRow label="Base fee per gas" value={formatGwei(block.baseFeePerGas)} />
        <DetailRow
          label="L1 checkpoint block"
          value={block.l1BlockNumber}
        />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
          Transactions ({block.transactions.length})
        </h2>
        <TxTable transactions={block.transactions} variant="detailed" />
      </div>
    </div>
  );
}
