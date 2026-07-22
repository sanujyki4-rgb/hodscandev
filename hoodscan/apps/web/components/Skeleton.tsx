/**
 * Skeleton placeholders shown by route-level `loading.tsx` files while a
 * server-rendered page streams in. They mirror the real page layout (same
 * `rounded-xl border border-border bg-surface` shells) so navigation feels
 * instant — the frame appears immediately and data fills in after.
 */

/** A single shimmering placeholder bar. Size it with utility classes. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-border/60 ${className}`}
      aria-hidden="true"
    />
  );
}

/** Page title + optional right-side badge placeholder. */
export function HeaderSkeleton({ withBadge = true }: { withBadge?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <Skeleton className="h-8 w-48" />
      {withBadge ? <Skeleton className="h-7 w-24 rounded-full" /> : null}
    </div>
  );
}

/**
 * A detail card (label / value rows) matching the `DetailRow` cards used on the
 * block and transaction pages.
 */
export function DetailCardSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center justify-between gap-4 border-b border-border py-3.5 last:border-b-0"
        >
          <Skeleton className="h-4 w-32 shrink-0" />
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
      ))}
    </div>
  );
}

/** A generic table placeholder (header strip + rows). */
export function TableSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-4 py-3">
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3.5">
            <Skeleton className="h-4 w-24 shrink-0" />
            <Skeleton className="h-4 w-32 shrink-0" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-20 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A horizontal row of tab-label placeholders. */
export function TabsSkeleton({ tabs = 5 }: { tabs?: number }) {
  return (
    <div className="flex gap-6 border-b border-border pb-3">
      {Array.from({ length: tabs }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-20" />
      ))}
    </div>
  );
}
