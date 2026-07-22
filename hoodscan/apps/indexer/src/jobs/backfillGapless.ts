import { prisma } from "@hoodscan/database";
import { sendRpc } from "@hoodscan/rpc";
import { BACKFILL_DELAY_MS } from "@hoodscan/config";
import { decodeBlock, decodeTransaction } from "../rpc/decoder";
import { saveBlock } from "../services/blockService";
import { saveTransactions } from "../services/transactionService";
import {
  extractTokenTransfers,
  saveTokenTransfers,
} from "../services/tokenTransferService";
import {
  extractNftTransfers,
  saveNftTransfers,
} from "../services/nftTransferService";
import {
  indexBlockInternalTransactions,
  internalTxIndexingEnabled,
} from "../rpc/traceOnDemand";
import { extractLogs, saveLogs } from "../services/logService";
import type { RawBlock, RawTransaction, RawReceipt } from "@hoodscan/types";

/**
 * Gapless backfill orchestrator for Robinhood Chain.
 *
 * =============================================================================
 * HOW TO RUN (env vars)
 * =============================================================================
 * From apps/indexer (loads ../../.env via dotenv like the other jobs):
 *   pnpm tsx src/jobs/backfillGapless.ts        # not wired to a script by default
 *
 * Environment variables (see packages/config/src/constants.ts):
 *   BACKFILL_START_BLOCK   inclusive range start (default: current chain head)
 *   BACKFILL_END_BLOCK     inclusive range end   (default: 0 = genesis)
 *   BACKFILL_DIRECTION     "reverse" (latest→oldest, DEFAULT) | "forward"
 *   BACKFILL_DELAY_MS      throttle between batches in ms (default 100)
 *   BACKFILL_CONCURRENCY   blocks fetched in parallel per batch (default 8)
 *
 * Provider routing is handled by @hoodscan/rpc `sendRpc`:
 *   ZAN_RPC_URLS / UNIBLOCK_RPC_URLS + UNIBLOCK_API_KEY / QUICKNODE_RPC_URLS.
 * Blocks + receipts/logs go over the "bulk" role (ZAN). Traces are NOT fetched
 * here — use apps/indexer/src/rpc/traceOnDemand.ts on demand instead.
 *
 * =============================================================================
 * THE FOUR SAFEGUARDS
 * =============================================================================
 *  (a) GAPLESS   — iterate a contiguous block range with no skips. Supports
 *                  reverse order (latest→oldest) so the freshest history lands
 *                  first, configurable via BACKFILL_DIRECTION.
 *  (b) CHECKPOINT— persist the last successfully processed block in the
 *                  existing IndexerCursor table and resume from it on restart.
 *  (c) RETRY +   — each block fetch uses sendRpc, so provider failover +
 *      FALLBACK    exponential backoff apply automatically. On TOTAL failure a
 *                  block is recorded in a "failed_blocks" retry queue (also an
 *                  IndexerCursor-style set) and processing continues — never a
 *                  silent skip.
 *  (d) VERIFY    — after storing a block, assert the stored tx count matches
 *                  eth_getBlockTransactionCountByNumber. On mismatch, re-fetch
 *                  the block ONCE; if it still mismatches, enqueue for retry.
 *
 * Idempotent: saveBlock upserts and saveTransactions/token/nft use
 * skipDuplicates, so re-running a processed block never duplicates rows.
 * =============================================================================
 */

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// IndexerCursor row name holding the last successfully processed block (b).
const CHECKPOINT_NAME = "gaplessBackfill";
// IndexerCursor row-name PREFIX for the failed-block retry queue (c). One row
// per failed block: "gaplessFailed:<blockNumber>" → the block number itself.
// Reusing IndexerCursor avoids a schema migration; a dedicated FailedBlock
// table would be the durable long-term home (see NOTE at enqueueFailed).
const FAILED_PREFIX = "gaplessFailed:";

type Direction = "reverse" | "forward";

export type GaplessBackfillOptions = {
  startBlock?: bigint;
  endBlock?: bigint;
  direction?: Direction;
  delayMs?: number;
  /** Blocks fetched+stored in parallel per batch (default 8). */
  concurrency?: number;
};

function toHex(n: bigint): string {
  return "0x" + n.toString(16);
}

// --- (b) CHECKPOINT helpers -------------------------------------------------

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

// --- (c) FAILED-BLOCK retry queue -------------------------------------------

/**
 * NOTE: persisted in IndexerCursor (one row per failed block) to avoid a
 * schema migration. If failed-block volume grows, add a dedicated
 * `FailedBlock { number BigInt @id, lastError String?, attempts Int }` model
 * and swap these three helpers for prisma.failedBlock operations.
 */
async function enqueueFailed(blockNumber: bigint): Promise<void> {
  const name = FAILED_PREFIX + blockNumber.toString();
  await prisma.indexerCursor.upsert({
    where: { name },
    create: { name, value: blockNumber },
    update: { value: blockNumber },
  });
}

async function dequeueFailed(blockNumber: bigint): Promise<void> {
  const name = FAILED_PREFIX + blockNumber.toString();
  await prisma.indexerCursor.deleteMany({ where: { name } });
}

// --- Core per-block processing (bulk role: block + receipts/logs) -----------

/**
 * Fetch a block (with full txs) and its receipts via the BULK role, then
 * persist block + transactions + ERC-20/721/1155 transfers using the EXISTING
 * services. Returns the number of transactions stored for the VERIFY step.
 * Does NOT fetch traces (on-demand only).
 */
async function processBlock(blockNumber: bigint): Promise<number> {
  const hex = toHex(blockNumber);

  // (c) sendRpc gives provider failover + backoff for free. Bulk role = ZAN.
  const raw = (await sendRpc("eth_getBlockByNumber", [hex, true])) as RawBlock | null;
  if (!raw) {
    // A null block in a contiguous range is anomalous — treat as failure so it
    // lands in the retry queue rather than being silently skipped.
    throw new Error(`eth_getBlockByNumber returned null for block ${blockNumber}`);
  }

  const block = decodeBlock(raw);
  await saveBlock(block);

  const rawTxs = (raw.transactions as RawTransaction[]) ?? [];

  // One eth_getBlockReceipts per block → gasUsed + effectiveGasPrice + logs.
  const receipts =
    ((await sendRpc("eth_getBlockReceipts", [hex])) as RawReceipt[] | null) ?? [];
  const receiptByHash = new Map(
    receipts.map((r) => [r.transactionHash.toLowerCase(), r])
  );

  const decodedTxs = rawTxs.map((tx) =>
    decodeTransaction(tx, receiptByHash.get(tx.hash.toLowerCase()))
  );
  await saveTransactions(decodedTxs);

  // Same receipts → token + NFT transfers (mirrors pollLatestBlock). All
  // idempotent (skipDuplicates), so re-processing never double-inserts.
  const tokenTransfers = extractTokenTransfers(
    receipts,
    block.number,
    block.timestamp
  );
  await saveTokenTransfers(tokenTransfers);
  // NOTE: TokenBalance / Token aggregates are intentionally NOT maintained
  // here. In reverse order the live incremental guard skips older blocks
  // (wrong balances) and the shared Token/TokenBalance upserts deadlock under
  // concurrency. They are recomputed correctly from TokenTransfer after the
  // backfill instead (order-independent).

  const nftTransfers = extractNftTransfers(receipts, block.number, block.timestamp);
  await saveNftTransfers(nftTransfers);

  // All event logs from the same receipts (no extra RPC) -> the "Events" tab.
  await saveLogs(extractLogs(receipts, block.number, block.timestamp));

  // Best-effort: trace this block's call frames and persist internal txns
  // idempotently (unique on (txHash, traceAddress)). Env-gated; swallows its
  // own errors so it can never break the VERIFY + checkpoint logic.
  if (internalTxIndexingEnabled()) {
    await indexBlockInternalTransactions(block.number, block.timestamp);
  }

  return rawTxs.length;
}

/**
 * (d) VERIFY: the block we stored should have as many transactions as the
 * chain reports. Prefer the block's own transactions length (already fetched);
 * cross-check against eth_getBlockTransactionCountByNumber. Returns true when
 * the counts agree.
 */
async function verifyBlock(
  blockNumber: bigint,
  storedTxCount: number
): Promise<boolean> {
  const hex = toHex(blockNumber);
  const countHex = (await sendRpc("eth_getBlockTransactionCountByNumber", [
    hex,
  ])) as string | null;
  if (countHex == null) return false;
  const chainCount = Number(BigInt(countHex));
  return chainCount === storedTxCount;
}

// --- Orchestration ----------------------------------------------------------

/**
 * Resolve the effective [from, to] range and iteration direction from options
 * + env + the persisted checkpoint. In reverse mode we resume DOWNWARD from
 * checkpoint-1; in forward mode we resume UPWARD from checkpoint+1.
 */
async function resolveRange(options: GaplessBackfillOptions): Promise<{
  start: bigint;
  end: bigint;
  direction: Direction;
} | null> {
  const direction: Direction =
    options.direction ??
    ((process.env.BACKFILL_DIRECTION as Direction) || "reverse");

  // Chain head, used as the default reverse-mode start.
  const headRaw = (await sendRpc("eth_getBlockByNumber", [
    "latest",
    false,
  ])) as { number: string };
  const head = BigInt(headRaw.number);

  const envStart = process.env.BACKFILL_START_BLOCK;
  const envEnd = process.env.BACKFILL_END_BLOCK;

  const configuredStart =
    options.startBlock ?? (envStart !== undefined ? BigInt(envStart) : head);
  const configuredEnd =
    options.endBlock ?? (envEnd !== undefined ? BigInt(envEnd) : 0n);

  const checkpoint = await readCheckpoint();

  if (direction === "reverse") {
    // latest → oldest. Resume just below the checkpoint if one exists.
    let start = configuredStart;
    if (checkpoint !== null && checkpoint - 1n < start) {
      start = checkpoint - 1n;
    }
    const end = configuredEnd;
    if (start < end) return null; // nothing left
    return { start, end, direction };
  }

  // forward: oldest → latest. Resume just above the checkpoint if one exists.
  let start = configuredEnd; // in forward mode the low end is the start
  if (checkpoint !== null && checkpoint + 1n > start) {
    start = checkpoint + 1n;
  }
  const end = configuredStart; // high end
  if (start > end) return null;
  return { start, end, direction };
}

/**
 * Run the gapless backfill. See the file header for the four safeguards and
 * the env vars. Safe to re-run — resumes from the checkpoint and is idempotent.
 */
/**
 * Fetch + store + VERIFY a single block, with one idempotent re-fetch on a
 * tx-count mismatch. NEVER throws: a total failure (all providers exhausted
 * or a persistent mismatch) is recorded in the failed-block retry queue (c)
 * and returned as a short reason string (null on success). On success any
 * prior failed-queue entry is cleared.
 */
async function handleBlock(blockNumber: bigint): Promise<string | null> {
  try {
    // (c) RETRY + FALLBACK is inside sendRpc (per-provider backoff + failover).
    const storedTxCount = await processBlock(blockNumber);

    // (d) VERIFY stored tx count against the chain.
    let ok = await verifyBlock(blockNumber, storedTxCount);
    if (!ok) {
      console.warn(`[gapless] block ${blockNumber} tx-count mismatch — re-fetching once…`);
      const retryCount = await processBlock(blockNumber); // idempotent re-fetch
      ok = await verifyBlock(blockNumber, retryCount);
    }

    if (!ok) {
      console.error(`[gapless] block ${blockNumber} still mismatched — enqueueing for retry.`);
      await enqueueFailed(blockNumber);
      return "tx-count mismatch";
    }

    // Successful block might have been a prior failure — clear it.
    await dequeueFailed(blockNumber);
    return null;
  } catch (err) {
    // (c) Total failure (all providers exhausted): record, do NOT skip.
    const reason = `RPC error: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[gapless] block ${blockNumber} failed after failover:`, err);
    await enqueueFailed(blockNumber);
    return reason;
  }
}

export async function backfillGapless(
  options: GaplessBackfillOptions = {}
): Promise<void> {
  const delayMs = options.delayMs ?? BACKFILL_DELAY_MS;
  const concurrency = Math.max(
    1,
    options.concurrency ??
      (process.env.BACKFILL_CONCURRENCY !== undefined
        ? Number(process.env.BACKFILL_CONCURRENCY)
        : 8)
  );

  const range = await resolveRange(options);
  if (!range) {
    console.log("[gapless] Nothing to backfill (range empty or checkpoint past end).");
    return;
  }

  const { start, end, direction } = range;
  const step = direction === "reverse" ? -1n : 1n;

  console.log(
    `[gapless] Backfilling ${direction} ${start} → ${end} ` +
      `(concurrency ${concurrency}, delay ${delayMs}ms/batch)…`
  );

  let processed = 0;
  let failed = 0;
  // Track the EXACT block numbers that failed, so logs can name them
  // instead of only counting them (no guessing which blocks need a look).
  const failedBlocks: bigint[] = [];

  // (a) GAPLESS: contiguous iteration, no gaps. `done` is inclusive of `end`.
  const done = (b: bigint) => (direction === "reverse" ? b < end : b > end);

  // Process up to `concurrency` contiguous blocks per step, IN PARALLEL. All
  // per-block work (fetch + store + VERIFY + retry-once) is idempotent, so a
  // partially-finished batch is safe to re-run on restart. We CHECKPOINT at
  // the batch's furthest block; any block that still failed sits in the retry
  // queue (c). Direction/order is unchanged — only throughput increases.
  let b = start;
  while (!done(b)) {
    const batch: bigint[] = [];
    for (let i = 0; i < concurrency && !done(b); i++) {
      batch.push(b);
      b += step;
    }

    // handleBlock never throws — a total failure returns false (already queued).
    const results = await Promise.all(batch.map((bn) => handleBlock(bn)));

    processed += batch.length;
    const batchFailed = batch
      .map((bn, i) => ({ block: bn, reason: results[i] }))
      .filter(
        (x): x is { block: bigint; reason: string } => x.reason !== null
      );
    failed += batchFailed.length;
    if (batchFailed.length > 0) {
      failedBlocks.push(...batchFailed.map((f) => f.block));
      console.warn(
        `[gapless] \u26a0 ${batchFailed.length} block(s) FAILED this batch: ` +
          batchFailed.map((f) => `${f.block} (${f.reason})`).join(", ")
      );
    }

    // (b) CHECKPOINT at the batch's furthest (last-iterated) block so a restart
    // resumes just beyond it — no gap, and idempotency covers any overlap.
    const lastInBatch = batch[batch.length - 1];
    await writeCheckpoint(lastInBatch);

    // Log roughly every 100 processed blocks, on batch boundaries.
    if (
      Math.floor(processed / 100) !== Math.floor((processed - batch.length) / 100)
    ) {
      console.log(
        `[gapless] …${processed} block(s) processed · ${failed} failed · at ${lastInBatch}`
      );
    }

    // Throttle between batches to respect provider quotas / rate limits.
    if (delayMs > 0) await sleep(delayMs);
  }

  console.log(
    `[gapless] Done. Processed ${processed} block(s); ${failed} enqueued for retry` +
      (failedBlocks.length > 0 ? `: ${failedBlocks.join(", ")}` : ".")
  );
}

/**
 * Re-drain the failed-blocks retry queue (c). Attempts each previously-failed
 * block again (full fetch + verify) and removes it on success. Call this
 * periodically or on a later run to close gaps left by transient failures.
 */
export async function retryFailedBlocks(): Promise<void> {
  const rows = await prisma.indexerCursor.findMany({
    where: { name: { startsWith: FAILED_PREFIX } },
    select: { value: true },
    orderBy: { value: "desc" },
  });

  if (rows.length === 0) {
    console.log("[gapless] No failed blocks to retry.");
    return;
  }

  const retryList = rows.map((r) => r.value.toString()).join(", ");
  console.log(
    `[gapless] Retrying ${rows.length} failed block(s): ${retryList}`
  );
  let recovered = 0;

  for (const { value: b } of rows) {
    try {
      const storedTxCount = await processBlock(b);
      if (await verifyBlock(b, storedTxCount)) {
        await dequeueFailed(b);
        recovered++;
      }
    } catch (err) {
      console.error(`[gapless] retry of block ${b} failed again:`, err);
    }
    if (BACKFILL_DELAY_MS > 0) await sleep(BACKFILL_DELAY_MS);
  }

  console.log(`[gapless] Retry pass done. Recovered ${recovered}/${rows.length}.`);
}

// Allow running this file directly (tsx src/jobs/backfillGapless.ts).
// Guarded so importing the module (e.g. from index.ts) does NOT auto-run it.
const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  /backfillGapless\.(ts|js)$/.test(process.argv[1]);

if (isDirectRun) {
  backfillGapless()
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error("[gapless] Fatal:", err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
