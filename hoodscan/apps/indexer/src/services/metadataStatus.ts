import Redis from "ioredis";

/**
 * Cross-process health beacon for the token-metadata resolver.
 *
 * The resolver loop lives in the INDEXER process, but the /tokens/metadata/status
 * endpoint that surfaces its health lives in the separate API process. They
 * can't share memory, so the indexer publishes a small snapshot to Redis (which
 * both already use) and the API reads it back.
 *
 * Publishing is strictly best-effort: any Redis failure is logged and swallowed
 * so it can NEVER disrupt the indexer's block/metadata loops.
 */

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

/** Redis key the API reads at GET /tokens/metadata/status. */
export const METADATA_STATUS_KEY = "hoodscan:metadata:status";

/**
 * TTL on the snapshot so a stopped/crashed indexer's last value expires instead
 * of being reported as current forever. Comfortably longer than the resolver's
 * slowest cadence (idle 60s / backoff ceiling 300s) so a healthy-but-idle
 * indexer never looks "gone".
 */
const METADATA_STATUS_TTL_S = 600;

const redis = new Redis(REDIS_URL, {
  // Mirror the API's cache client: never hard-fail on a flaky Redis.
  maxRetriesPerRequest: 2,
  lazyConnect: true,
});

redis.on("error", (err) => {
  console.error("[metadata-status] Redis error:", err.message);
});

/** Snapshot shape shared (by convention) with the API reader. */
export interface MetadataStatusSnapshot {
  /** Current resolver backoff level (0 = healthy, higher = backing off). */
  backoffLevel: number;
  /** Tokens still awaiting metadata (name IS NULL) as last observed. */
  backlog: number;
  /** ISO timestamp of this snapshot. */
  updatedAt: string;
}

/**
 * Publish the resolver's current health to Redis. Best-effort and fire-and-
 * forget friendly (safe to call as `void publishMetadataStatus(...)`).
 */
export async function publishMetadataStatus(
  backoffLevel: number,
  backlog: number
): Promise<void> {
  const snapshot: MetadataStatusSnapshot = {
    backoffLevel,
    backlog,
    updatedAt: new Date().toISOString(),
  };
  try {
    await redis.set(
      METADATA_STATUS_KEY,
      JSON.stringify(snapshot),
      "EX",
      METADATA_STATUS_TTL_S
    );
  } catch (err) {
    console.error("[metadata-status] publish failed:", err);
  }
}
