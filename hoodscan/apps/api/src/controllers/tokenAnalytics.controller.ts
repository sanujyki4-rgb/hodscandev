import type { Request, Response } from "express";
import { prisma } from "@hoodscan/database";
import { serializeBigInt } from "../utils/serialize";

import { ADDRESS_RE } from "../utils/address";
const ALLOWED_DAYS = [7, 14, 30, 90] as const;
const DEFAULT_DAYS = 30;

interface DailyRow {
  day: Date;
  transfers: number;
  senders: number;
  receivers: number;
}

/**
 * GET /tokens/:address/daily?days=30
 *
 * Per-day analytics for a single ERC-20 token, derived from the
 * TokenTransfer table (transfer count + unique senders/receivers per
 * day). Powers the token page's "Analytics" tab. Uses the
 * TokenTransfer(tokenAddress) / (blockNumber) indexes; no migration.
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

  const rows = await prisma.$queryRaw<DailyRow[]>`
    SELECT
      date_trunc('day', "timestamp")            AS day,
      COUNT(*)::int                             AS transfers,
      COUNT(DISTINCT "fromAddress")::int        AS senders,
      COUNT(DISTINCT "toAddress")::int          AS receivers
    FROM "TokenTransfer"
    WHERE "tokenAddress" = ${address}
      AND "timestamp" >= date_trunc('day', NOW()) - (${days}::int - 1) * INTERVAL '1 day'
    GROUP BY day
    ORDER BY day ASC
  `;

  const points = rows.map((r) => ({
    date: new Date(r.day).toISOString().slice(0, 10),
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
