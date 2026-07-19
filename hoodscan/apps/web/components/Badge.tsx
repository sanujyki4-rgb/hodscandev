/**
 * Status/direction pill used across BlocksTable (Finalized/Pending),
 * L1L2Table (Relayed/Pending), and AddressTxTable (IN/OUT/SELF) —
 * each table wrote its own `${condition ? "bg-lime/15 text-lime" :
 * ...}` ternary. The color-per-tone mapping is centralized here;
 * `className` still lets a caller override shape (AddressTxTable's
 * direction badge is a narrower non-pill shape, not the default
 * rounded-full).
 */
export type BadgeTone = "positive" | "warning" | "muted";

const TONE_CLASSES: Record<BadgeTone, string> = {
  positive: "bg-lime/15 text-lime",
  warning: "bg-warning/15 text-warning",
  muted: "bg-muted/15 text-muted",
};

export function Badge({
  tone,
  children,
  className = "rounded-full px-2 py-0.5",
}: {
  tone: BadgeTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={`text-sm font-medium ${TONE_CLASSES[tone]} ${className}`}>
      {children}
    </span>
  );
}
