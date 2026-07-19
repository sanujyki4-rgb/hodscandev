/**
 * Label/value row for the detail-page info panels (block, tx). Was
 * defined identically, verbatim, in both block/[number]/page.tsx and
 * tx/[hash]/page.tsx.
 */
export function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-2.5 last:border-b-0">
      <span className="shrink-0 text-sm text-muted">{label}</span>
      <span className="break-all text-right font-mono text-sm text-ink">{value}</span>
    </div>
  );
}
