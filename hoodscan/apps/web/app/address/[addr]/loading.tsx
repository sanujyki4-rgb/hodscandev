import {
  Skeleton,
  TabsSkeleton,
  TableSkeleton,
} from "@/components/Skeleton";

export default function AddressLoading() {
  return (
    <div className="flex flex-col gap-6">
      {/* Header: title + mono address */}
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      {/* Hash-driven tabs */}
      <TabsSkeleton tabs={4} />

      {/* Active tab table */}
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-32" />
        <TableSkeleton rows={10} />
      </div>
    </div>
  );
}
