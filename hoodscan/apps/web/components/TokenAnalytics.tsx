"use client";

import { useEffect, useState } from "react";
import { getTokenDaily, type TokenDailyResponse } from "@/lib/api";

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

const RANGES = [7, 14, 30, 90];

function TransfersBarChart({
  points,
}: {
  points: TokenDailyResponse["points"];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...points.map((p) => p.transfers), 1);
  const n = points.length;

  return (
    <div className="text-lime">
      <div className="relative h-48 w-full">
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="border-t border-border/60" />
          ))}
        </div>
        <div className="absolute inset-0 flex items-end gap-[2px]">
          {points.map((p, i) => {
            const pct = (p.transfers / max) * 100;
            const active = hover === i;
            return (
              <div
                key={i}
                className="group flex h-full flex-1 items-end"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <div
                  className="w-full rounded-t-[3px] transition-opacity"
                  style={{
                    height: `${Math.max(pct, p.transfers > 0 ? 2 : 0)}%`,
                    opacity: active ? 1 : 0.72,
                    backgroundImage:
                      "linear-gradient(to top, color-mix(in srgb, currentColor 30%, transparent), currentColor)",
                  }}
                />
              </div>
            );
          })}
        </div>
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border border-border bg-base px-3 py-2 shadow-xl"
            style={{ left: `${((hover + 0.5) / n) * 100}%` }}
          >
            <p className="whitespace-nowrap text-[11px] text-muted">{shortDate(points[hover].date)}</p>
            <p className="whitespace-nowrap font-mono text-sm font-bold tabular-nums text-lime">
              {points[hover].transfers.toLocaleString("en-US")} transfers
            </p>
            <p className="whitespace-nowrap font-mono text-[11px] text-muted">
              {points[hover].senders.toLocaleString("en-US")} senders ·{" "}
              {points[hover].receivers.toLocaleString("en-US")} receivers
            </p>
          </div>
        )}
      </div>
      {n >= 2 && (
        <div className="mt-2 flex justify-between font-mono text-[10px] tabular-nums text-muted">
          <span>{shortDate(points[0].date)}</span>
          <span className="hidden sm:inline">{shortDate(points[Math.floor(n / 2)].date)}</span>
          <span>{shortDate(points[n - 1].date)}</span>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 font-mono text-lg font-bold tabular-nums text-ink">{value}</p>
    </div>
  );
}

export function TokenAnalytics({ address }: { address: string }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<TokenDailyResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getTokenDaily(address, days).then((res) => {
      if (alive) {
        setData(res);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [address, days]);

  if (loading && !data) {
    return <p className="px-1 py-6 text-sm text-muted">Loading analytics…</p>;
  }

  if (!data || data.points.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
        No transfer activity indexed for this token in the selected range.
      </div>
    );
  }

  const s = data.summary;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Transfer activity, derived from indexed Transfer events.
        </p>
        <div className="inline-flex rounded-xl border border-border bg-surface p-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setDays(r)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                r === days ? "bg-lime-bright text-black shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <MiniStat label="Total transfers" value={s.totalTransfers.toLocaleString("en-US")} />
        <MiniStat label="Avg / active day" value={s.avgTransfersPerDay.toLocaleString("en-US")} />
        <MiniStat
          label="Peak day"
          value={
            s.peakDay
              ? `${s.peakDay.transfers.toLocaleString("en-US")}`
              : "—"
          }
        />
      </div>

      <div className="rounded-2xl border border-border bg-surface p-4">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
          Transfers per day
        </p>
        <TransfersBarChart points={data.points} />
      </div>
    </div>
  );
}
