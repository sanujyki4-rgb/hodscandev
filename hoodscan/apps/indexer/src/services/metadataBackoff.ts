/**
 * Pure decision helpers for the adaptive + exponential-backoff token-metadata
 * scheduler used by the indexer loop (see src/index.ts → tokenMetadataLoop).
 *
 * This module is INTENTIONALLY dependency-free (no DB, no RPC, no timers): it
 * only maps inputs (backlog size, backoff level, pass outcome) to decisions
 * (batch size, next interval, next backoff level). That keeps the scheduling
 * logic deterministic and unit-testable in isolation without a real provider
 * or database — see scripts/testBackoff.ts.
 */

/** Base cadences (ms) chosen by backlog size. */
export const TOKEN_METADATA_FAST_INTERVAL_MS = 5_000; // huge backlog
export const TOKEN_METADATA_BUSY_INTERVAL_MS = 15_000; // moderate backlog
export const TOKEN_METADATA_IDLE_INTERVAL_MS = 60_000; // near-empty / empty queue

/** Per-token throttle applied inside the resolver (quota-safe). */
export const TOKEN_METADATA_INTER_TOKEN_DELAY_MS = 200;

/** Exponential-backoff ceiling + max doubling level. */
export const TOKEN_METADATA_BACKOFF_MAX_MS = 300_000; // 5 min ceiling
export const TOKEN_METADATA_BACKOFF_MAX_LEVEL = 6;

/** Outcome of a single resolver pass, used to decide the next backoff level. */
export interface MetadataPassOutcome {
  /** How many tokens the pass attempted. */
  processed: number;
  /** How many of those actually got usable metadata (name/symbol). */
  resolved: number;
  /** True if the pass threw (DB/RPC transport error, etc.). */
  threw?: boolean;
}

/**
 * Map the current backlog to a batch size + base delay-until-next-pass.
 * Bigger backlog => bigger batch + shorter interval; empty => small batch + idle.
 */
export function tokenMetadataPlan(backlog: number): {
  batch: number;
  intervalMs: number;
} {
  if (backlog > 500) {
    return { batch: 100, intervalMs: TOKEN_METADATA_FAST_INTERVAL_MS };
  }
  if (backlog > 100) {
    return { batch: 50, intervalMs: TOKEN_METADATA_BUSY_INTERVAL_MS };
  }
  if (backlog > 0) {
    return { batch: 25, intervalMs: TOKEN_METADATA_BUSY_INTERVAL_MS };
  }
  // Nothing pending — check back rarely.
  return { batch: 25, intervalMs: TOKEN_METADATA_IDLE_INTERVAL_MS };
}

/**
 * Scale a base interval by the current backoff level (baseMs * 2^level),
 * capped at TOKEN_METADATA_BACKOFF_MAX_MS. Level 0 returns the base unchanged.
 */
export function applyMetadataBackoff(baseMs: number, level: number): number {
  if (level <= 0) return baseMs;
  return Math.min(baseMs * 2 ** level, TOKEN_METADATA_BACKOFF_MAX_MS);
}

/**
 * Given the current backoff level and the outcome of a pass, compute the next
 * level. A thrown pass, or a pass that attempted tokens but resolved NONE, is
 * treated as a provider-health failure and bumps the level (capped). Any
 * success — or an empty/idle pass — is treated as healthy and resets to 0.
 */
export function nextMetadataBackoffLevel(
  level: number,
  outcome: MetadataPassOutcome
): number {
  const { processed, resolved, threw } = outcome;
  if (threw || (processed > 0 && resolved === 0)) {
    return Math.min(level + 1, TOKEN_METADATA_BACKOFF_MAX_LEVEL);
  }
  return 0;
}
