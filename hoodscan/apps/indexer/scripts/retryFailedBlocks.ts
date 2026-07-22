import { prisma } from "@hoodscan/database";
import { retryFailedBlocks } from "../src/jobs/backfillGapless";

/**
 * Re-drain the gapless backfill's failed-block retry queue (IndexerCursor rows
 * named "gaplessFailed:<block>"). Re-fetches + verifies each block and clears
 * it from the queue on success. Safe to run anytime; idempotent.
 *
 * Run:  pnpm backfill:retry        (from repo root or apps/indexer)
 */
retryFailedBlocks()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error("[retry] Fatal:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
