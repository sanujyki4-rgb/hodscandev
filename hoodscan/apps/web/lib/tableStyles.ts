/**
 * Shared zebra-striped, hover-highlighted row className used by every
 * data table (BlocksTable, TxTable, L1L2Table, AddressTxTable). Was
 * copy-pasted verbatim into all four — extracted here so a future
 * tweak (row height, hover color) only needs to change in one place.
 */
export function tableRowClass(index: number): string {
  const stripe = index % 2 === 1 ? "bg-surface/40" : "";
  return `group h-[52px] whitespace-nowrap border-l-2 border-l-transparent transition hover:border-l-lime-bright hover:bg-lime-bright/[0.03] ${stripe}`;
}
