import type { Request, Response } from "express";
import { prisma } from "@hoodscan/database";
import { serializeBigInt } from "../utils/serialize";

/**
 * Allowed look-back windows (in days) for the daily-stats charts.
 * Restricting to a small set keeps the query bounded and cache-friendly
 * (the Block.timestamp index does the heavy lifting).
 */
const ALLOWED_DAYS = [7, 14, 30, 90] as const;
const DEFAULT_DAYS = 30;

/** Raw row shape returned by the daily aggregation query. */
interface DailyRow {
  day: Date;
  blocks: number;
  transactions: number;
  avgTxPerBlock: number;
  avgGasUtil: number; // 0..1 fraction
  avgBaseFeeWei: number; // wei
  avgSize: number; // bytes
}

/**
 * GET /stats/daily?days=30
 *
 * Per-day aggregation over the Block table (which carries txCount,
 * gasUsed/gasLimit, baseFeePerGas and size), grouped by calendar day.
 * Everything is derived from data hoodscan has already indexed — no
 * migration, no extra table. Uses the existing Block.timestamp index.
 *
 * Returns points oldest -> newest so the frontend can render left -> right.
 */
export async function getDailyStats(req: Request, res: Response) {
  const requested = Number(req.query.days);
  const days = (ALLOWED_DAYS as readonly number[]).includes(requested)
    ? requested
    : DEFAULT_DAYS;

  const rows = await prisma.$queryRaw<DailyRow[]>`
    SELECT
      date_trunc('day', "timestamp")                                   AS day,
      COUNT(*)::int                                                    AS blocks,
      COALESCE(SUM("txCount"), 0)::int                                 AS transactions,
      COALESCE(AVG("txCount"), 0)::float8                              AS "avgTxPerBlock",
      COALESCE(AVG(
        CASE WHEN "gasLimit" > 0
             THEN "gasUsed"::float8 / "gasLimit"::float8
             ELSE 0 END
      ), 0)::float8                                                    AS "avgGasUtil",
      COALESCE(AVG("baseFeePerGas"::float8), 0)::float8                AS "avgBaseFeeWei",
      COALESCE(AVG("size"), 0)::float8                                 AS "avgSize"
    FROM "Block"
    WHERE "timestamp" >= date_trunc('day', NOW()) - (${days}::int - 1) * INTERVAL '1 day'
    GROUP BY day
    ORDER BY day ASC
  `;

  const points = rows.map((r) => ({
    // YYYY-MM-DD (UTC calendar day)
    date: new Date(r.day).toISOString().slice(0, 10),
    blocks: r.blocks,
    transactions: r.transactions,
    avgTxPerBlock: Number(r.avgTxPerBlock.toFixed(2)),
    // fraction 0..1 -> percentage with 2 decimals
    gasUtilPct: Number((r.avgGasUtil * 100).toFixed(2)),
    // wei -> Gwei
    avgBaseFeeGwei: Number((r.avgBaseFeeWei / 1e9).toFixed(4)),
    avgBlockSizeBytes: Math.round(r.avgSize),
  }));

  // Range-wide roll-ups for the summary strip above the charts.
  const totalTransactions = points.reduce((s, p) => s + p.transactions, 0);
  const totalBlocks = points.reduce((s, p) => s + p.blocks, 0);
  const activeDays = points.filter((p) => p.blocks > 0).length;
  const peakTxDay =
    points.length > 0
      ? points.reduce((max, p) => (p.transactions > max.transactions ? p : max))
      : null;

  res.json(
    serializeBigInt({
      days,
      allowedDays: ALLOWED_DAYS,
      summary: {
        totalTransactions,
        totalBlocks,
        activeDays,
        avgTxPerDay: activeDays > 0 ? Math.round(totalTransactions / activeDays) : 0,
        peakTxDay: peakTxDay
          ? { date: peakTxDay.date, transactions: peakTxDay.transactions }
          : null,
      },
      points,
    })
  );
}
