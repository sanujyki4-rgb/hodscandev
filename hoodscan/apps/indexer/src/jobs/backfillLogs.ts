import { prisma } from "@hoodscan/database";
import { sendRpc } from "@hoodscan/rpc";
import { BACKFILL_DELAY_MS } from "@hoodscan/config";
import { extractLogs, saveLogs } from "../services/logService";
import type { RawReceipt } from "@hoodscan/types";

/**
 * Backfill event logs for ALREADY-indexed blocks.
 *
 * The live poll + gapless backfill now save logs as they process each block
 * (from the receipts they already fetch), but blocks stored BEFORE that hook
 * existed have no Log rows. This job walks stored blocks (newest first),
 * re-fetches each block's receipts (eth_getBlockReceipts), and persists their
 * logs.
 *
 * Resumable + idempotent:
 *   - checkpoint in IndexerCursor (name "logsBackfill") = lowest block number
 *     processed so far; a restart resumes just below it.
 *   - blocks that already have logs are skipped.
 *   - saveLogs is idempotent (unique (txHash, logIndex)).
 *
 * Env:
 *   BACKFILL_CONCURRENCY  blocks fetched in parallel per batch (default 4)
 *   BACKFILL_DELAY_MS     throttle between batches (from @hoodscan/config)
 */

const CHECKPOINT_NAME = "logsBackfill";
const PAGE_SIZE = 500;

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
const toHex = (n: bigint) => "0x" + n.toString(16);

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

export async function backfillLogs(): Promise<void> {
  const concurrency = Math.max(
    1,
    process.env.BACKFILL_CONCURRENCY !== undefined
      ? Number(process.env.BACKFILL_CONCURRENCY)
      : 4
  );

  const checkpoint = await readCheckpoint();
  let cursor: bigint | null = checkpoint;

  let processed = 0;
  let filled = 0;
  let skipped = 0;

  console.log(
    `[logs-backfill] Starting (concurrency ${concurrency}` +
      (checkpoint !== null ? `, resuming below block ${checkpoint}` : "") +
      ")…"
  );

  for (;;) {
    const where = cursor !== null ? { number: { lt: cursor } } : undefined;
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
          const existing = await prisma.log.count({
            where: { blockNumber: b.number },
          });
          if (existing > 0) {
            skipped++;
            return;
          }
          try {
            const receipts =
              ((await sendRpc("eth_getBlockReceipts", [
                toHex(b.number),
              ])) as RawReceipt[] | null) ?? [];
            const rows = extractLogs(receipts, b.number, b.timestamp);
            const { count } = await saveLogs(rows);
            if (count > 0) filled++;
          } catch (err) {
            console.error(`[logs-backfill] block ${b.number} failed:`, err);
          }
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
          `[logs-backfill] …${processed} block(s) processed · ${filled} filled · ${skipped} skipped · at ${lastInBatch}`
        );
      }

      if (BACKFILL_DELAY_MS > 0) await sleep(BACKFILL_DELAY_MS);
    }

    cursor = blocks[blocks.length - 1].number;
  }

  console.log(
    `[logs-backfill] Done. Processed ${processed} block(s); ${filled} filled, ${skipped} already had logs.`
  );
}

// Allow running directly (tsx src/jobs/backfillLogs.ts). Guarded so importing
// the module does NOT auto-run it.
const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  /backfillLogs\.(ts|js)$/.test(process.argv[1]);

if (isDirectRun) {
  backfillLogs()
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error("[logs-backfill] Fatal:", err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
