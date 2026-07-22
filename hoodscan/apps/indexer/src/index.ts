import { INDEXER_POLL_INTERVAL_MS } from "@hoodscan/config";
import { pollLatestBlock } from "./jobs/pollLatestBlock";
import { pollFinalizedBlock } from "./jobs/pollFinalizedBlock";
import { backfillBlocks } from "./jobs/backfillBlocks";
import { backfillReceipts } from "./jobs/backfillReceipts";
import { backfillNftTransfers } from "./jobs/backfillNftTransfers";
import { watchL1Messages } from "./jobs/watchL1Messages";
import {
  resolvePendingTokenMetadata,
  countPendingTokenMetadata,
} from "./services/tokenMetadataResolver";
import {
  tokenMetadataPlan,
  applyMetadataBackoff,
  nextMetadataBackoffLevel,
  TOKEN_METADATA_INTER_TOKEN_DELAY_MS,
  TOKEN_METADATA_BUSY_INTERVAL_MS,
  TOKEN_METADATA_IDLE_INTERVAL_MS,
} from "./services/metadataBackoff";
import { publishMetadataStatus } from "./services/metadataStatus";
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

// Token metadata (name/symbol/decimals/totalSupply) is resolved OFF the
// block hot path: the block jobs create bare Token rows as they see
// transfers, and this loop backfills their metadata. It is ADAPTIVE and
// self-scheduling: batch size + the delay until the next pass scale with the
// current backlog (Token rows with name IS NULL). A big backlog (e.g. right
// after a backfill) drains fast with large batches on a short interval, then
// automatically slows to an idle cadence as the backlog shrinks so we never
// waste provider quota polling an empty queue. A per-token delay always
// throttles the underlying eth_calls, keeping every pass quota-safe.
// Batch sizing, cadence, and backoff decisions live in the pure, testable
// ./services/metadataBackoff module. Only the mutable run-state stays here.
let isResolvingMetadata = false;
let metadataBackoffLevel = 0;

async function tokenMetadataLoop() {
  // Guard against overlapping runs if a pass takes longer than the interval.
  if (isResolvingMetadata) return;
  isResolvingMetadata = true;
  let nextDelayMs = TOKEN_METADATA_IDLE_INTERVAL_MS;
  let observedBacklog = 0;
  try {
    const backlog = await countPendingTokenMetadata();
    observedBacklog = backlog;
    const { batch, intervalMs } = tokenMetadataPlan(backlog);
    if (backlog > 0) {
      const { processed, resolved } = await resolvePendingTokenMetadata(
        batch,
        TOKEN_METADATA_INTER_TOKEN_DELAY_MS
      );
      metadataBackoffLevel = nextMetadataBackoffLevel(metadataBackoffLevel, {
        processed,
        resolved,
      });
      nextDelayMs = applyMetadataBackoff(intervalMs, metadataBackoffLevel);
      if (processed > 0) {
        const backoffNote =
          metadataBackoffLevel > 0 ? ` [backoff L${metadataBackoffLevel}]` : "";
        console.log(
          `[indexer] Resolved metadata for ${resolved}/${processed} token(s) ` +
            `(backlog ~${backlog}, next pass in ${Math.round(
              nextDelayMs / 1000
            )}s)${backoffNote}`
        );
      }
    } else {
      // Nothing pending — healthy idle. Clear any prior backoff.
      metadataBackoffLevel = 0;
      nextDelayMs = intervalMs;
    }
  } catch (err) {
    // A thrown error (DB/RPC transport, etc.) — treat as unhealthy, back off.
    metadataBackoffLevel = nextMetadataBackoffLevel(metadataBackoffLevel, {
      processed: 0,
      resolved: 0,
      threw: true,
    });
    nextDelayMs = applyMetadataBackoff(
      TOKEN_METADATA_BUSY_INTERVAL_MS,
      metadataBackoffLevel
    );
    console.error(
      `[indexer] resolvePendingTokenMetadata failed (backoff L${metadataBackoffLevel}, ` +
        `next pass in ${Math.round(nextDelayMs / 1000)}s):`,
      err
    );
  } finally {
    isResolvingMetadata = false;
    // Publish resolver health so the API can surface it (best-effort).
    void publishMetadataStatus(metadataBackoffLevel, observedBacklog);
    // Self-schedule the next pass at the adaptive (+ backoff) cadence.
    setTimeout(tokenMetadataLoop, nextDelayMs);
  }
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

  // Token metadata resolver — adaptive + self-scheduling (see
  // tokenMetadataLoop). Kicked off once; it re-arms its own timer based on
  // the live backlog, so no fixed setInterval here.
  console.log("[indexer] Entering adaptive token-metadata loop...");
  void tokenMetadataLoop();

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
