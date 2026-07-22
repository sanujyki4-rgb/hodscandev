import { prisma } from "@hoodscan/database";
import { BACKFILL_DELAY_MS } from "@hoodscan/config";
import { indexBlockInternalTransactions } from "../rpc/traceOnDemand";

/**
 * Backfill internal transactions for ALREADY-indexed blocks.
 *
 * The live poll + gapless backfill now trace each block as they process it (see
 * indexBlockInternalTransactions in rpc/traceOnDemand.ts), but blocks stored
 * BEFORE that hook existed have no InternalTransaction rows. This job walks the
 * stored blocks (newest first, so the freshest history fills in first), traces
 * any block that has zero internal txns, and persists them.
 *
 * Resumable + idempotent:
 *   - checkpoint in IndexerCursor (name "internalTxBackfill") = the lowest block
 *     number processed so far; a restart resumes just below it.
 *   - blocks that already have internal txns are skipped (no wasted trace call).
 *   - indexBlockInternalTransactions is idempotent (unique (txHash, traceAddress)).
 *
 * Env:
 *   BACKFILL_CONCURRENCY  blocks traced in parallel per batch (default 4)
 *   BACKFILL_DELAY_MS     throttle between batches (from @hoodscan/config)
 */

const CHECKPOINT_NAME = "internalTxBackfill";
const PAGE_SIZE = 500;

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

async function readCheckpoint(): Promise<bigint | null> {
  const row = await prisma.indexerCursor.findUnique({
    where: { name: CHECKPOINT_NAME },
  });
  return row ? row.value : null;
}

async function writeCheckpoint(value: bigint): Promise<void> {
  await prisma.indexerCursor.upsert({
    where: { name: CHECKPOINT_NAME },
    create: { name: CHECKPOINT_NAME, value },
    update: { value },
  });
}

export async function backfillInternalTx(): Promise<void> {
  const concurrency = Math.max(
    1,
    process.env.BACKFILL_CONCURRENCY !== undefined
      ? Number(process.env.BACKFILL_CONCURRENCY)
      : 4
  );

  // Resume: only consider blocks strictly below the last checkpoint.
  const checkpoint = await readCheckpoint();
  let cursor: bigint | null = checkpoint;

  let processed = 0;
  let traced = 0;
  let skipped = 0;

  console.log(
    `[internal-backfill] Starting (concurrency ${concurrency}` +
      (checkpoint !== null ? `, resuming below block ${checkpoint}` : "") +
      ")…"
  );

  // Walk blocks newest → oldest in pages.
  for (;;) {
    const where =
      cursor !== null ? { number: { lt: cursor } } : undefined;
    const blocks = await prisma.block.findMany({
      where,
      select: { number: true, timestamp: true },
      orderBy: { number: "desc" },
      take: PAGE_SIZE,
    });
    if (blocks.length === 0) break;

    for (let i = 0; i < blocks.length; i += concurrency) {
      const batch = blocks.slice(i, i + concurrency);

      await Promise.all(
        batch.map(async (b) => {
          // Skip blocks that already have internal txns (idempotent + cheap).
          const existing = await prisma.internalTransaction.count({
            where: { blockNumber: b.number },
          });
          if (existing > 0) {
            skipped++;
            return;
          }
          const { count } = await indexBlockInternalTransactions(
            b.number,
            b.timestamp
          );
          if (count > 0) traced++;
        })
      );

      processed += batch.length;
      const lastInBatch = batch[batch.length - 1].number;
      await writeCheckpoint(lastInBatch);

      if (
        Math.floor(processed / 100) !==
        Math.floor((processed - batch.length) / 100)
      ) {
        console.log(
          `[internal-backfill] …${processed} block(s) processed · ${traced} traced · ${skipped} skipped · at ${lastInBatch}`
        );
      }

      if (BACKFILL_DELAY_MS > 0) await sleep(BACKFILL_DELAY_MS);
    }

    cursor = blocks[blocks.length - 1].number;
  }

  console.log(
    `[internal-backfill] Done. Processed ${processed} block(s); ${traced} traced, ${skipped} already had internal txns.`
  );
}

// Allow running this file directly (tsx src/jobs/backfillInternalTx.ts).
// Guarded so importing the module does NOT auto-run it.
const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  /backfillInternalTx\.(ts|js)$/.test(process.argv[1]);

if (isDirectRun) {
  backfillInternalTx()
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error("[internal-backfill] Fatal:", err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
