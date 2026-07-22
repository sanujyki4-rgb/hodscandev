import type { Request, Response } from "express";
import { prisma } from "@hoodscan/database";
import { serializeBigInt } from "../utils/serialize";

import { ADDRESS_RE } from "../utils/address";
const ALLOWED_DAYS = [7, 14, 30, 90] as const;
const DEFAULT_DAYS = 30;

/**
 * GET /tokens/:address/daily?days=30
 *
 * Per-day analytics for a single ERC-20 token (transfer count + unique
 * senders/receivers per day). Powers the token page's "Analytics" tab.
 *
 * Reads the pre-aggregated TokenDailyStat rollup (maintained by the
 * indexer + the `backfill:token-daily` job) instead of aggregating the raw
 * TokenTransfer table at request time. This turns a COUNT(DISTINCT) scan
 * over millions of rows into an O(days) primary-key lookup. The rollup
 * only stores days that actually had transfers, so `points` contains only
 * active days — identical to the previous GROUP BY behaviour.
 */
export async function getTokenDaily(req: Request, res: Response) {
  if (!ADDRESS_RE.test(req.params.address)) {
    return res.status(400).json({ error: "Invalid address format" });
  }
  const address = req.params.address.toLowerCase();

  const requested = Number(req.query.days);
  const days = (ALLOWED_DAYS as readonly number[]).includes(requested)
    ? requested
    : DEFAULT_DAYS;

  // UTC midnight of (today - (days - 1)) — inclusive lower bound of the window.
  const now = new Date();
  const windowStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  windowStart.setUTCDate(windowStart.getUTCDate() - (days - 1));

  const rows = await prisma.tokenDailyStat.findMany({
    where: { tokenAddress: address, day: { gte: windowStart } },
    orderBy: { day: "asc" },
  });

  const points = rows.map((r) => ({
    date: r.day.toISOString().slice(0, 10),
    transfers: r.transfers,
    senders: r.senders,
    receivers: r.receivers,
  }));

  const totalTransfers = points.reduce((s, p) => s + p.transfers, 0);
  const activeDays = points.filter((p) => p.transfers > 0).length;
  const peak =
    points.length > 0
      ? points.reduce((m, p) => (p.transfers > m.transfers ? p : m))
      : null;

  res.json(
    serializeBigInt({
      tokenAddress: address,
      days,
      allowedDays: ALLOWED_DAYS,
      summary: {
        totalTransfers,
        activeDays,
        avgTransfersPerDay: activeDays > 0 ? Math.round(totalTransfers / activeDays) : 0,
        peakDay: peak ? { date: peak.date, transfers: peak.transfers } : null,
      },
      points,
    })
  );
}
