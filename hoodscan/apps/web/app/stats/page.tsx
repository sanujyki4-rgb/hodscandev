import Link from "next/link";
import { StatCard } from "@/components/StatCard";
import { StatsCharts } from "@/components/StatsCharts";
import {
  getDailyStats,
  getLatestBlocks,
  getPaginatedBlocks,
  getPaginatedTransactions,
} from "@/lib/api";
import { avgBlockTimeMs } from "@/lib/format";

export const revalidate = 10;

const RANGES = [7, 14, 30, 90] as const;

const RANGE_LABEL: Record<number, string> = {
  7: "Last 7 days",
  14: "Last 14 days",
  30: "Last 30 days",
  90: "Last 90 days",
};

export default async function StatsPage({
  searchParams,
}: {
  searchParams: { days?: string };
}) {
  const requested = Number(searchParams.days);
  const days = (RANGES as readonly number[]).includes(requested) ? requested : 30;

  const [recentBlocks, blockTotals, txTotals, daily] = await Promise.all([
    getLatestBlocks(50),
    getPaginatedBlocks(1, 0),
    getPaginatedTransactions(1, 0),
    getDailyStats(days),
  ]);

  const avgBlockTimeMsValue = recentBlocks ? avgBlockTimeMs(recentBlocks) : 0;
  const latestBlock = recentBlocks?.[0];
  const summary = daily?.summary;

  const peakDate = summary?.peakTxDay
    ? new Date(`${summary.peakTxDay.date}T00:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : null;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Chain stats</h1>
        <p className="mt-1 text-sm text-muted">
          Live figures for Robinhood Chain, derived from data hoodscan has indexed so far.
        </p>
      </div>

      {/* Network at a glance ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Latest block"
          value={latestBlock ? `#${latestBlock.number}` : "—"}
          accent
        />
        <StatCard
          label="Avg block time"
          value={avgBlockTimeMsValue ? `${avgBlockTimeMsValue.toFixed(0)}ms` : "—"}
          hint="Measured over the last 50 blocks"
        />
        <StatCard label="Chain ID" value="4663" hint="Robinhood Chain Mainnet" />
        <StatCard
          label="Blocks indexed"
          value={blockTotals ? blockTotals.total.toLocaleString() : "—"}
          hint="By this hoodscan instance"
        />
        <StatCard
          label="Transactions indexed"
          value={txTotals ? txTotals.total.toLocaleString() : "—"}
          hint="By this hoodscan instance"
        />
        <StatCard label="Mainnet launch" value="Jul 1, 2026" hint="Built on Arbitrum" />
      </div>

      {/* Activity over time ──────────────────────────────────────── */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold tracking-tight">Activity over time</h2>
            <p className="mt-0.5 text-sm text-muted">
              {summary ? (
                <>
                  <span className="font-mono font-semibold text-ink">
                    {summary.totalTransactions.toLocaleString()}
                  </span>{" "}
                  transactions across{" "}
                  <span className="font-mono font-semibold text-ink">
                    {summary.totalBlocks.toLocaleString()}
                  </span>{" "}
                  blocks
                  {peakDate && summary.peakTxDay ? (
                    <>
                      {" · peak "}
                      <span className="font-mono font-semibold text-ink">
                        {summary.peakTxDay.transactions.toLocaleString()}
                      </span>{" "}
                      on {peakDate}
                    </>
                  ) : null}
                </>
              ) : (
                RANGE_LABEL[days]
              )}
            </p>
          </div>

          {/* Range selector — SSR-friendly links (?days=) */}
          <div
            role="tablist"
            aria-label="Chart range"
            className="inline-flex rounded-xl border border-border bg-surface p-1"
          >
            {RANGES.map((r) => {
              const active = r === days;
              return (
                <Link
                  key={r}
                  href={`/stats?days=${r}`}
                  role="tab"
                  aria-selected={active}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    active
                      ? "bg-lime-bright text-black shadow-sm"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  {r}d
                </Link>
              );
            })}
          </div>
        </div>

        {daily ? (
          <StatsCharts points={daily.points} />
        ) : (
          <div className="rounded-2xl border border-border bg-surface p-10 text-center text-sm text-muted">
            Couldn&apos;t load chart data. Is the API running?
          </div>
        )}
      </div>
    </div>
  );
}
