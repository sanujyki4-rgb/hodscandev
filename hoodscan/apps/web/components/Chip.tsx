/**
 * Neutral pill for a single inline value inside a table cell (Method
 * name, Txns count) — distinct from Badge, which communicates a
 * status/direction via color. Same base classes were copy-pasted into
 * BlocksTable (Txns), TxTable (Method), and AddressTxTable (Method).
 */
export function Chip({
  children,
  nums = false,
}: {
  children: React.ReactNode;
  /** Set for numeric content, e.g. the Txns count — see globals.css .nums. */
  nums?: boolean;
}) {
  return (
    <span className={`rounded-md bg-muted/10 px-1.5 py-0.5 text-sm text-ink ${nums ? "nums" : ""}`}>
      {children}
    </span>
  );
}
