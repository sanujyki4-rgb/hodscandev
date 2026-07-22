/**
 * Standard "Loading X…" placeholder — was copy-pasted (same classes)
 * across ReadContractSection, WriteContractSection, and ContractPanel.
 */
export function Loading({ label }: { label: string }) {
  return <p className="px-1 py-6 text-sm text-muted">{label}</p>;
}
