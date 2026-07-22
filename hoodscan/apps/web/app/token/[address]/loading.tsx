import {
  Skeleton,
  TabsSkeleton,
  TableSkeleton,
} from "@/components/Skeleton";

export default function TokenLoading() {
  return (
    <div className="flex flex-col gap-6">
      {/* Header: token name + address */}
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-border bg-surface px-4 py-3"
          >
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-4 w-24" />
          </div>
        ))}
      </div>

      {/* Hash-driven tabs */}
      <TabsSkeleton tabs={6} />

      {/* Active tab table */}
      <TableSkeleton rows={10} />
    </div>
  );
}
