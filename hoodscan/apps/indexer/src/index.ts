import { INDEXER_POLL_INTERVAL_MS } from "@hoodscan/config";
import { pollLatestBlock } from "./jobs/pollLatestBlock";
import { pollFinalizedBlock } from "./jobs/pollFinalizedBlock";
import { backfillBlocks } from "./jobs/backfillBlocks";
import { backfillReceipts } from "./jobs/backfillReceipts";
import { backfillNftTransfers } from "./jobs/backfillNftTransfers";
import { watchL1Messages } from "./jobs/watchL1Messages";
import { logL2RpcConfig } from "./rpc/client";
import { logL1RpcConfig } from "./rpc/l1Client";

// L1 blocks land roughly every ~12s — no need to poll anywhere near
// as often as the L2 poll loop above.
const L1_WATCH_INTERVAL_MS = 15_000;
let isWatchingL1 = false;

async function l1WatchLoop() {
  if (isWatchingL1) return;
  isWatchingL1 = true;
  try {
    await watchL1Messages();
  } catch (err) {
    console.error("[indexer] watchL1Messages failed:", err);
  }
  isWatchingL1 = false;
}

let isPolling = false;

async function pollLoop() {
  // Guard against overlapping runs if a poll takes longer than the interval.
  if (isPolling) return;
  isPolling = true;

  try {
    const blockNumber = await pollLatestBlock();
    if (blockNumber !== null) {
      console.log(`[indexer] Indexed block ${blockNumber}`);
    }
  } catch (err) {
    console.error("[indexer] pollLatestBlock failed:", err);
  }

  try {
    await pollFinalizedBlock();
  } catch (err) {
    console.error("[indexer] pollFinalizedBlock failed:", err);
  }

  isPolling = false;
}

async function main() {
  console.log("[indexer] Starting hoodscan indexer...");
  logL2RpcConfig();
  logL1RpcConfig();

  // Live L2 poll + L1 watcher start immediately — do not wait for backfill.
  // Block/tx writes are idempotent (upsert / skipDuplicates), so concurrent
  // backfill of older gaps and poll of "latest" is safe.
  console.log(
    `[indexer] Entering poll loop (every ${INDEXER_POLL_INTERVAL_MS}ms)...`
  );
  void pollLoop();
  setInterval(pollLoop, INDEXER_POLL_INTERVAL_MS);

  // L1 message watcher — no-ops if no L1 RPC URLs are configured.
  void l1WatchLoop();
  setInterval(l1WatchLoop, L1_WATCH_INTERVAL_MS);

  // Historical catch-up runs in the background so downtime gaps fill
  // without blocking live indexing or L1 message watching.
  console.log("[indexer] Starting background backfill (non-blocking)...");
  void backfillBlocks({ concurrency: 5 }).catch((err) => {
    console.error("[indexer] Background backfill failed:", err);
  });

  // Receipt backfill for older rows missing gasUsed/effectiveGasPrice
  // (the actual tx fee). Throttled internally; runs in the background.
  console.log("[indexer] Starting receipt backfill (non-blocking)...");
  void backfillReceipts().catch((err) => {
    console.error("[indexer] Receipt backfill failed:", err);
  });

  // NFT backfill: historical ERC-721/1155 transfers. Cursor-based so it
  // resumes across restarts and no-ops once caught up. Runs concurrently
  // with the other backfills so live + historical stay balanced.
  console.log("[indexer] Starting NFT backfill (non-blocking)...");
  void backfillNftTransfers().catch((err) => {
    console.error("[indexer] NFT backfill failed:", err);
  });
}

main().catch((err) => {
  console.error("[indexer] Fatal error:", err);
  process.exit(1);
});
