import {
  HeaderSkeleton,
  DetailCardSkeleton,
  Skeleton,
  TableSkeleton,
} from "@/components/Skeleton";

export default function BlockLoading() {
  return (
    <div className="flex flex-col gap-6">
      <HeaderSkeleton />

      {/* Block detail rows */}
      <DetailCardSkeleton rows={8} />

      {/* Transactions table */}
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-40" />
        <TableSkeleton rows={8} />
      </div>
    </div>
  );
}
