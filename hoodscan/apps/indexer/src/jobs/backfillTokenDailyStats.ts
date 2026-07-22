import { prisma } from "@hoodscan/database";

/**
 * One-time (idempotent) bulk backfill of the TokenDailyStat rollup from the
 * full TokenTransfer history. Safe to re-run: ON CONFLICT DO UPDATE keeps
 * every (tokenAddress, day) row in sync. After this runs once, the indexer
 * (tokenTransferService.saveTokenTransfers) keeps the rollup fresh going
 * forward. Run with: pnpm backfill:token-daily
 */
export async function backfillTokenDailyStats() {
  const started = Date.now();
  console.log("[token-daily-backfill] Rebuilding TokenDailyStat from TokenTransfer…");

  const affected = await prisma.$executeRawUnsafe(`
    INSERT INTO "TokenDailyStat" ("tokenAddress", "day", "transfers", "senders", "receivers", "updatedAt")
    SELECT
      "tokenAddress",
      date_trunc('day', "timestamp") AS day,
      COUNT(*)::int,
      COUNT(DISTINCT "fromAddress")::int,
      COUNT(DISTINCT "toAddress")::int,
      NOW()
    FROM "TokenTransfer"
    GROUP BY "tokenAddress", date_trunc('day', "timestamp")
    ON CONFLICT ("tokenAddress", "day") DO UPDATE SET
      "transfers" = EXCLUDED."transfers",
      "senders" = EXCLUDED."senders",
      "receivers" = EXCLUDED."receivers",
      "updatedAt" = NOW()
  `);

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `[token-daily-backfill] Done. ${affected} (tokenAddress, day) row(s) upserted in ${secs}s.`
  );
}

// Allow running directly (tsx src/jobs/backfillTokenDailyStats.ts). Guarded so
// importing the module does NOT auto-run it.
const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  /backfillTokenDailyStats\.(ts|js)$/.test(process.argv[1]);

if (isDirectRun) {
  backfillTokenDailyStats()
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error("[token-daily-backfill] Fatal:", err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
