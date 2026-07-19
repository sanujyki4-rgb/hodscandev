/**
 * Standard "nothing to show" state for data tables — was copy-pasted
 * (same classes, different message) into every table component.
 */
export function EmptyState({ message }: { message: string }) {
  return (
    <p className="rounded-xl border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
      {message}
    </p>
  );
}
