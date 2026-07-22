/**
 * Info/warning callout box — was copy-pasted (same shape, different
 * color) across ReadContractSection, WriteContractSection,
 * ContractPanel, and VerifiedSource (verification status notes).
 */
export function Callout({
  tone,
  children,
  className = "text-sm text-muted",
}: {
  tone: "warning" | "positive";
  children: React.ReactNode;
  className?: string;
}) {
  const toneClasses =
    tone === "warning" ? "border-warning/30 bg-warning/[0.06]" : "border-lime/30 bg-lime/[0.06]";
  return <div className={`rounded-xl border px-4 py-3 ${toneClasses} ${className}`}>{children}</div>;
}
