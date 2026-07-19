"use client";

import { useState } from "react";
import type { DailyStatPoint } from "@/lib/api";

/* ────────────────────────────────────────────────────────────────
   StatsCharts — interactive, dependency-free charts for /stats.

   All rendering is plain SVG + divs styled with the app's Tailwind
   tokens. Colour is driven by a `text-*` class on the wrapper and
   `currentColor` inside the SVG (same trick as StatsBar's
   ActivityChart) so every series automatically matches the theme.
   ──────────────────────────────────────────────────────────────── */

type ColorKey = "lime" | "warning" | "danger";

const COLOR_CLASS: Record<ColorKey, string> = {
  lime: "text-lime",
  warning: "text-warning",
  danger: "text-danger",
};

function fullNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/** e.g. "2026-07-18" -> "Jul 18". */
function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

interface Series {
  label: string;
  color: ColorKey;
  /** Formats a value for the tooltip + header (full precision). */
  format: (v: number) => string;
  /** Suffix shown after the big header value (e.g. "%", "Gwei"). */
  unit?: string;
  values: number[];
  dates: string[];
}

/** Percentage change of the last vs the first non-zero day in range. */
function rangeDelta(values: number[]): number | null {
  const firstIdx = values.findIndex((v) => v > 0);
  if (firstIdx === -1) return null;
  const first = values[firstIdx];
  const last = values[values.length - 1];
  if (first === 0) return null;
  return ((last - first) / first) * 100;
}

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null || !isFinite(delta)) return null;
  const up = delta >= 0;
  const cls = up ? "text-lime bg-lime/10" : "text-danger bg-danger/10";
  return (
    <span className={`rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold ${cls}`}>
      {up ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
    </span>
  );
}

function ChartCardShell({
  series,
  latest,
  children,
}: {
  series: Series;
  latest: number;
  children: React.ReactNode;
}) {
  const delta = rangeDelta(series.values);
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-surface p-4 shadow-md shadow-black/[0.03] ring-1 ring-black/[0.02]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
            {series.label}
          </p>
          <p className="mt-1 flex items-baseline gap-1.5">
            <span className={`font-mono text-xl font-bold tabular-nums ${COLOR_CLASS[series.color]}`}>
              {series.format(latest)}
            </span>
            {series.unit && <span className="text-sm text-muted">{series.unit}</span>}
          </p>
          <p className="text-xs text-muted">latest day</p>
        </div>
        <DeltaBadge delta={delta} />
      </div>
      {children}
    </div>
  );
}

/* ── Bar chart (used for the headline "Daily transactions") ─────── */
function BarChart({ series, height = "h-40" }: { series: Series; height?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...series.values, 1);
  const n = series.values.length;

  return (
    <div className={COLOR_CLASS[series.color]}>
      <div className={`relative w-full ${height}`}>
        {/* horizontal grid lines */}
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="border-t border-border/60" />
          ))}
        </div>

        {/* bars */}
        <div className="absolute inset-0 flex items-end gap-[2px]">
          {series.values.map((v, i) => {
            const pct = (v / max) * 100;
            const active = hover === i;
            return (
              <div
                key={i}
                className="group relative flex h-full flex-1 items-end"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <div
                  className="w-full rounded-t-[3px] transition-opacity"
                  style={{
                    height: `${Math.max(pct, v > 0 ? 2 : 0)}%`,
                    opacity: active ? 1 : 0.72,
                    backgroundImage:
                      "linear-gradient(to top, color-mix(in srgb, currentColor 30%, transparent), currentColor)",
                  }}
                />
              </div>
            );
          })}
        </div>

        {/* tooltip */}
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border border-border bg-base px-3 py-2 shadow-xl"
            style={{ left: `${((hover + 0.5) / n) * 100}%` }}
          >
            <p className="whitespace-nowrap text-[11px] text-muted">{shortDate(series.dates[hover])}</p>
            <p className={`whitespace-nowrap font-mono text-sm font-bold tabular-nums ${COLOR_CLASS[series.color]}`}>
              {series.format(series.values[hover])}
              {series.unit ? ` ${series.unit}` : ""}
            </p>
          </div>
        )}
      </div>
      <AxisLabels dates={series.dates} />
    </div>
  );
}

/* ── Area / line chart (blocks, gas, base fee) ──────────────────── */
function AreaChart({ series, height = "h-28" }: { series: Series; height?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const values = series.values;
  const n = values.length;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;

  const W = 100;
  const H = 100;
  const padY = 6;
  const usableH = H - padY * 2;

  const coords = values.map((v, i) => {
    const x = n === 1 ? W / 2 : (i / (n - 1)) * W;
    const y = padY + usableH - ((v - min) / span) * usableH;
    return { x, y };
  });

  const line = coords.map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(" ");
  const area = `0,${H} ${line} ${W},${H}`;
  const gradId = `grad-${series.label.replace(/[^a-z]/gi, "")}`;

  return (
    <div className={COLOR_CLASS[series.color]}>
      <div className={`relative w-full ${height}`}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-full w-full overflow-visible"
          role="img"
          aria-label={series.label}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.28} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </linearGradient>
          </defs>

          {[0.25, 0.5, 0.75].map((t) => (
            <line
              key={t}
              x1={0}
              y1={padY + usableH * t}
              x2={W}
              y2={padY + usableH * t}
              stroke="currentColor"
              strokeOpacity={0.08}
              strokeWidth={0.3}
            />
          ))}

          <polygon points={area} fill={`url(#${gradId})`} stroke="none" />
          <polyline
            points={line}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />

          {hover !== null && (
            <>
              <line
                x1={coords[hover].x}
                y1={0}
                x2={coords[hover].x}
                y2={H}
                stroke="currentColor"
                strokeOpacity={0.3}
                strokeWidth={0.4}
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={coords[hover].x}
                cy={coords[hover].y}
                r={2.4}
                fill="currentColor"
                stroke="rgb(var(--color-base))"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
        </svg>

        {/* invisible hover columns */}
        <div className="absolute inset-0 flex">
          {values.map((_, i) => (
            <div
              key={i}
              className="h-full flex-1"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </div>

        {hover !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border border-border bg-base px-3 py-2 shadow-xl"
            style={{ left: `${((hover + 0.5) / n) * 100}%` }}
          >
            <p className="whitespace-nowrap text-[11px] text-muted">{shortDate(series.dates[hover])}</p>
            <p className={`whitespace-nowrap font-mono text-sm font-bold tabular-nums ${COLOR_CLASS[series.color]}`}>
              {series.format(values[hover])}
              {series.unit ? ` ${series.unit}` : ""}
            </p>
          </div>
        )}
      </div>
      <AxisLabels dates={series.dates} />
    </div>
  );
}

function AxisLabels({ dates }: { dates: string[] }) {
  if (dates.length < 2) return null;
  const first = dates[0];
  const mid = dates[Math.floor(dates.length / 2)];
  const last = dates[dates.length - 1];
  return (
    <div className="mt-2 flex justify-between font-mono text-[10px] tabular-nums text-muted">
      <span>{shortDate(first)}</span>
      <span className="hidden sm:inline">{shortDate(mid)}</span>
      <span>{shortDate(last)}</span>
    </div>
  );
}

/* ── Public component ───────────────────────────────────────────── */
export function StatsCharts({ points }: { points: DailyStatPoint[] }) {
  if (points.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-10 text-center text-sm text-muted">
        No indexed activity in this range yet. Once hoodscan indexes a few blocks, the charts fill in.
      </div>
    );
  }

  const dates = points.map((p) => p.date);
  const latest = points[points.length - 1];

  const txSeries: Series = {
    label: "Daily transactions",
    color: "lime",
    format: fullNumber,
    values: points.map((p) => p.transactions),
    dates,
  };
  const blocksSeries: Series = {
    label: "Blocks per day",
    color: "lime",
    format: fullNumber,
    values: points.map((p) => p.blocks),
    dates,
  };
  const tpbSeries: Series = {
    label: "Avg transactions / block",
    color: "warning",
    format: (v) => v.toFixed(2),
    values: points.map((p) => p.avgTxPerBlock),
    dates,
  };
  const feeSeries: Series = {
    label: "Avg base fee",
    color: "lime",
    unit: "Gwei",
    format: (v) => (v < 0.01 && v > 0 ? v.toExponential(2) : v.toFixed(v < 1 ? 4 : 2)),
    values: points.map((p) => p.avgBaseFeeGwei),
    dates,
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Headline chart */}
      <ChartCardShell series={txSeries} latest={latest.transactions}>
        <BarChart series={txSeries} />
      </ChartCardShell>

      {/* Secondary charts */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <ChartCardShell series={blocksSeries} latest={latest.blocks}>
          <AreaChart series={blocksSeries} />
        </ChartCardShell>
        <ChartCardShell series={tpbSeries} latest={latest.avgTxPerBlock}>
          <AreaChart series={tpbSeries} />
        </ChartCardShell>
        <ChartCardShell series={feeSeries} latest={latest.avgBaseFeeGwei}>
          <AreaChart series={feeSeries} />
        </ChartCardShell>
      </div>
    </div>
  );
}
