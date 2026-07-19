/**
 * "N {noun} found" line above a paginated table — was copy-pasted
 * (same structure/classes) in address/[addr]/page.tsx,
 * AddressTokenTransfersSection.tsx, and AddressNftTransfersSection.tsx.
 */
export function ResultCount({ total, noun }: { total: number; noun: string }) {
  return (
    <p className="text-sm text-muted">
      <span className="font-mono text-ink">{total.toLocaleString("en-US")}</span>{" "}
      {noun}
      {total === 1 ? "" : "s"} found
    </p>
  );
}
