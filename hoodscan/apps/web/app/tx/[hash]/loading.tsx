import {
  HeaderSkeleton,
  DetailCardSkeleton,
  Skeleton,
} from "@/components/Skeleton";

export default function TransactionLoading() {
  return (
    <div className="flex flex-col gap-6">
      <HeaderSkeleton />

      {/* Transaction detail rows */}
      <DetailCardSkeleton rows={12} />

      {/* Input data block */}
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-28" />
        <div className="rounded-xl border border-border bg-surface px-4 py-3">
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    </div>
  );
}
