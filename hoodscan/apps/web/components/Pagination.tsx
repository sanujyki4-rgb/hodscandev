import Link from "next/link";

const DEFAULT_CAP = 500000;

export function Pagination({
  basePath,
  page,
  limit,
  total,
  noun = "records",
  cappedAt = DEFAULT_CAP,
  queryPrefix = "",
  pageParam = "page",
  hashSuffix = "",
}: {
  basePath: string;
  page: number;
  limit: number;
  total: number;
  noun?: string;
  cappedAt?: number;
  queryPrefix?: string;
  pageParam?: string;
  hashSuffix?: string;
}) {
  const totalPages = Math.max(Math.ceil(total / limit), 1);
  const hasPrev = page > 1;
  const hasNext = page < totalPages;
  const isCapped = total >= cappedAt;

  const linkClass = (enabled: boolean) =>
    `rounded-lg border border-border px-3 py-1.5 text-xs font-medium ${
      enabled
        ? "text-ink hover:border-lime hover:text-lime"
        : "cursor-not-allowed text-muted/50"
    }`;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-xs text-muted">
        A total of {total.toLocaleString()} {noun} found
        {isCapped ? " (Showing the last 500k records)" : ""}
      </span>
      <div className="flex items-center gap-2">
        <Link
          href={hasPrev ? `${basePath}?${queryPrefix}${pageParam}=1${hashSuffix}` : "#"}
          aria-disabled={!hasPrev}
          className={linkClass(hasPrev)}
        >
          First
        </Link>
        <Link
          href={hasPrev ? `${basePath}?${queryPrefix}${pageParam}=${page - 1}${hashSuffix}` : "#"}
          aria-disabled={!hasPrev}
          className={linkClass(hasPrev)}
        >
          ← Prev
        </Link>
        <span className="px-1 text-xs text-muted">
          Page {page.toLocaleString()} of {totalPages.toLocaleString()}
        </span>
        <Link
          href={hasNext ? `${basePath}?${queryPrefix}${pageParam}=${page + 1}${hashSuffix}` : "#"}
          aria-disabled={!hasNext}
          className={linkClass(hasNext)}
        >
          Next →
        </Link>
        <Link
          href={hasNext ? `${basePath}?${queryPrefix}${pageParam}=${totalPages}${hashSuffix}` : "#"}
          aria-disabled={!hasNext}
          className={linkClass(hasNext)}
        >
          Last
        </Link>
      </div>
    </div>
  );
}
