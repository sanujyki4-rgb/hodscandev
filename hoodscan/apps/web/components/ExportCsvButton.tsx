"use client";

/**
 * Client-side CSV export. Takes already-prepared header + row data (strings)
 * and triggers a browser download via a Blob — no extra API call, so it
 * exports exactly the rows currently loaded on the page. Values are RFC-4180
 * quoted (doubling embedded quotes) so commas/newlines survive.
 */
function toCsv(headers: string[], rows: string[][]): string {
  const escape = (v: string) => {
    const s = v ?? "";
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers, ...rows].map((r) => r.map(escape).join(","));
  return lines.join("\r\n");
}

export function ExportCsvButton({
  filename,
  headers,
  rows,
}: {
  filename: string;
  headers: string[];
  rows: string[][];
}) {
  function handleExport() {
    const csv = toCsv(headers, rows);
    // Prepend a UTF-8 BOM so Excel opens non-ASCII correctly.
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const disabled = rows.length === 0;

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink transition hover:border-lime hover:text-lime disabled:cursor-not-allowed disabled:opacity-50"
      title={disabled ? "Nothing to export" : "Download this page as CSV"}
    >
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
        <path d="M10 2a1 1 0 011 1v7.6l2.3-2.3a1 1 0 011.4 1.4l-4 4a1 1 0 01-1.4 0l-4-4a1 1 0 011.4-1.4L9 10.6V3a1 1 0 011-1z" />
        <path d="M3 14a1 1 0 011 1v1a1 1 0 001 1h10a1 1 0 001-1v-1a1 1 0 112 0v1a3 3 0 01-3 3H5a3 3 0 01-3-3v-1a1 1 0 011-1z" />
      </svg>
      Export CSV
    </button>
  );
}
