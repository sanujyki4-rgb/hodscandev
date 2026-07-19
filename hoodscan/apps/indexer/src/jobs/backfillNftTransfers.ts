import { prisma } from "@hoodscan/database";
import { RECEIPT_BACKFILL_DELAY_MS } from "@hoodscan/config";
import { getBlockReceipts } from "../rpc/client";
import { getLatestIndexedBlockNumber } from "../services/blockService";
import {
  extractNftTransfers,
  saveNftTransfers,
} from "../services/nftTransferService";

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// Name of the persisted cursor row in IndexerCursor.
const CURSOR_NAME = "nftBackfill";
// DB page size when walking historical blocks.
const PAGE = 500;

async function readCursor(): Promise<bigint> {
  const row = await prisma.indexerCursor.findUnique({
    where: { name: CURSOR_NAME },
  });
  // -1 so the very first run starts at block 0 (gt -1).
  return row ? row.value : -1n;
}

async function writeCursor(value: bigint): Promise<void> {
  await prisma.indexerCursor.upsert({
    where: { name: CURSOR_NAME },
    create: { name: CURSOR_NAME, value },
    update: { value },
  });
}

/**
 * Background NFT backfill — the historical counterpart to the live NFT
 * extraction in jobs/pollLatestBlock.ts. Runs automatically on startup
 * alongside backfillBlocks / backfillReceipts so the indexer stays
 * balanced: live blocks and historical gaps are handled concurrently.
 *
 * Walks already-indexed blocks from a PERSISTED cursor upward to the
 * latest indexed block (captured once at start — new blocks past that are
 * already handled live), re-scanning each block's receipts for ERC-721 /
 * ERC-1155 transfers. Throttled one block at a time to respect the
 * rate-limited public RPC (mirrors backfillReceipts).
 *
 * Resumable + idempotent: the cursor advances per block and is persisted,
 * and saveNftTransfers uses skipDuplicates on (txHash, logIndex,
 * batchIndex). So a restart continues where it left off, and once the
 * cursor reaches the tip the job simply no-ops on future startups.
 */
export async function backfillNftTransfers(): Promise<void> {
  const head = await getLatestIndexedBlockNumber();
  if (head === null) {
    console.log("[backfillNft] No indexed blocks yet — nothing to scan.");
    return;
  }

  let cursor = await readCursor();
  if (cursor >= head) {
    console.log(
      `[backfillNft] Already caught up (cursor ${cursor} ≥ head ${head}).`
    );
    return;
  }

  console.log(
    `[backfillNft] Scanning blocks ${cursor + 1n} → ${head} for NFT transfers…`
  );

  let processed = 0;
  let savedRows = 0;

  while (true) {
    const blocks = await prisma.block.findMany({
      where: { number: { gt: cursor, lte: head } },
      select: { number: true, timestamp: true },
      orderBy: { number: "asc" },
      take: PAGE,
    });
    if (blocks.length === 0) break;

    for (const b of blocks) {
      try {
        const hexNumber = "0x" + b.number.toString(16);
        const receipts = await getBlockReceipts(hexNumber);
        const rows = extractNftTransfers(receipts, b.number, b.timestamp);
        const result = await saveNftTransfers(rows);
        savedRows += result.count ?? 0;
      } catch (err) {
        console.error(`[backfillNft] block ${b.number} failed:`, err);
      }
      cursor = b.number;
      await writeCursor(cursor);
      processed++;
      if (processed % 100 === 0) {
        console.log(
          `[backfillNft] …${processed} block(s) scanned · ` +
            `${savedRows} NFT row(s) saved · at block ${cursor}`
        );
      }
      // Throttle between blocks to avoid hammering the public RPC.
      await sleep(RECEIPT_BACKFILL_DELAY_MS);
    }
  }

  console.log(
    `[backfillNft] Done. Scanned ${processed} block(s), ` +
      `saved ${savedRows} NFT transfer row(s).`
  );
}
