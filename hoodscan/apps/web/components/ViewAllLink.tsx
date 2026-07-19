import Link from "next/link";

/**
 * Footer "View all …" link under a homepage table panel — was
 * copy-pasted verbatim (same classes) into BlocksTable, TxTable, and
 * L1L2Table, differing only in href/label.
 */
export function ViewAllLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="block border-t border-border bg-surface px-4 py-2.5 text-center text-sm font-medium text-lime hover:bg-lime/5"
    >
      View all {label} →
    </Link>
  );
}
