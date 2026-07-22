import { sendRpc } from "@hoodscan/rpc";
import {
  decodeCallTracer,
  saveInternalTransactions,
  type InternalTransactionRow,
} from "../services/internalTxService";

/**
 * On-demand (lazy) transaction/block trace fetcher for Robinhood Chain.
 *
 * -----------------------------------------------------------------------------
 * WHY (kenapa) on-demand, not bulk?
 * -----------------------------------------------------------------------------
 * Robinhood Chain has ~13.9M blocks. Tracing all of them via debug_trace* would
 * blow through every provider quota (and ZAN blocks debug_trace* entirely). So
 * traces are NEVER bulk-backfilled. Instead we fetch a trace only when it is
 * actually requested (e.g. a user opens a tx's internal-transactions tab), then
 * cache the result so repeat requests are free.
 *
 * Routing: every call goes through `sendRpc(..., { roleHint: "trace" })`, which
 * prefers the "trace" role (Uniblock) and fails over to "fallback" (QuickNode)
 * — and NEVER touches ZAN, which cannot serve debug_trace*.
 * -----------------------------------------------------------------------------
 */

/**
 * Default tracer config. `callTracer` returns the call tree (internal txs),
 * which is what an explorer's "Internal Transactions" tab needs. Callers can
 * override via the `tracer`/`tracerConfig` params if they want a struct log or
 * a different tracer.
 */
export type TraceConfig = {
  tracer?: string;
  tracerConfig?: Record<string, unknown>;
  timeout?: string;
};

const DEFAULT_TRACE_CONFIG: TraceConfig = { tracer: "callTracer" };

/**
 * Cache layer.
 *
 * TODO(hoodscan): there is no Trace table in the Prisma schema yet, so this
 * uses a process-local in-memory Map. It is a correct cache (idempotent, keyed
 * by tx hash / block id + tracer) but NOT durable across restarts and NOT
 * shared between the indexer and the API process. When traces become a
 * first-class feature, replace `traceCache` with a `Trace` model
 * (key: identifier + tracer, value: JSON) and swap get/set for prisma upsert.
 */
const traceCache = new Map<string, unknown>();

function cacheKey(kind: "tx" | "block", id: string, tracer: string): string {
  return `${kind}:${id.toLowerCase()}:${tracer}`;
}

/**
 * Trace a single transaction (debug_traceTransaction). Result is cached by
 * (txHash, tracer). Routes to the "trace" role (Uniblock → QuickNode).
 *
 * Optionally persists the decoded internal transactions: when `persist` is
 * supplied AND this call actually fetched a FRESH trace (cache miss), the
 * callTracer result is decoded and its nested calls are written to the
 * InternalTransaction table (idempotent on (txHash, traceAddress)). This is
 * how internal txs are populated — lazily, only when a trace is requested,
 * never in a bulk backfill. Persistence is best-effort: a failure there is
 * swallowed so it can never break the trace return. Omitting `persist` keeps
 * the original behaviour (fetch/cache only, no DB writes).
 *
 * @param txHash  0x-prefixed transaction hash
 * @param config  optional tracer config (defaults to callTracer)
 * @param persist optional parent-tx context; when given, a freshly-fetched
 *                trace is decoded + saved as InternalTransaction rows
 */
export async function getTransactionTrace(
  txHash: string,
  config: TraceConfig = DEFAULT_TRACE_CONFIG,
  persist?: { blockNumber: bigint; timestamp: Date }
): Promise<unknown> {
  const tracer = config.tracer ?? "callTracer";
  const key = cacheKey("tx", txHash, tracer);

  const cached = traceCache.get(key);
  if (cached !== undefined) return cached;

  const result = await sendRpc(
    "debug_traceTransaction",
    [txHash, config],
    { roleHint: "trace" }
  );

  traceCache.set(key, result);

  // Lazy persistence of internal transactions — only on a FRESH fetch, and
  // only when the caller opted in. Best-effort: never let a DB failure break
  // the trace response.
  if (persist) {
    try {
      const rows = decodeCallTracer(result, {
        txHash,
        blockNumber: persist.blockNumber,
        timestamp: persist.timestamp,
      });
      await saveInternalTransactions(rows);
    } catch (err) {
      console.error(
        `[trace] failed to persist internal txs for ${txHash}:`,
        err
      );
    }
  }

  return result;
}

/**
 * Trace an entire block (debug_traceBlockByNumber for a number, or
 * debug_traceBlockByHash for a 0x…32-byte hash). Result is cached by
 * (blockId, tracer). Routes to the "trace" role (Uniblock → QuickNode).
 *
 * @param blockNumberOrHash a bigint/number block number, a hex block number
 *        ("0x1a2b"), or a 0x-prefixed 66-char block hash.
 * @param config optional tracer config (defaults to callTracer)
 */
export async function getBlockTrace(
  blockNumberOrHash: bigint | number | string,
  config: TraceConfig = DEFAULT_TRACE_CONFIG
): Promise<unknown> {
  const tracer = config.tracer ?? "callTracer";

  // A 66-char 0x string is a block hash; anything else is a block number.
  const isHash =
    typeof blockNumberOrHash === "string" &&
    blockNumberOrHash.startsWith("0x") &&
    blockNumberOrHash.length === 66;

  let method: string;
  let identifier: string;

  if (isHash) {
    method = "debug_traceBlockByHash";
    identifier = blockNumberOrHash as string;
  } else {
    method = "debug_traceBlockByNumber";
    // Normalise number → hex quantity ("0x1a2b"), as the RPC expects.
    identifier =
      typeof blockNumberOrHash === "string"
        ? blockNumberOrHash
        : "0x" + BigInt(blockNumberOrHash).toString(16);
  }

  const key = cacheKey("block", identifier, tracer);
  const cached = traceCache.get(key);
  if (cached !== undefined) return cached;

  const result = await sendRpc(method, [identifier, config], {
    roleHint: "trace",
  });

  traceCache.set(key, result);
  return result;
}

/** Clear the in-memory trace cache (mainly for tests). */
export function clearTraceCache(): void {
  traceCache.clear();
}

/**
 * Whether automatic internal-transaction indexing is enabled. Controlled by
 * the INDEX_INTERNAL_TX env var — enabled by default, disabled only when set
 * to exactly "false" or "0". Lets the heavy tracing be turned off per-process.
 */
export function internalTxIndexingEnabled(): boolean {
  const v = process.env.INDEX_INTERNAL_TX;
  return v !== "false" && v !== "0";
}

/**
 * Trace a whole block via debug_traceBlockByNumber (callTracer) and persist
 * every transaction's internal transactions to the InternalTransaction table.
 *
 * debug_traceBlockByNumber returns an ARRAY of { txHash, result } entries (one
 * per tx), where `result` is the callTracer root frame. We decode each frame's
 * nested calls and bulk-insert them (idempotent on (txHash, traceAddress)).
 *
 * BEST-EFFORT: this never throws. Any RPC/decode/DB failure is logged and
 * swallowed so it can never break block processing (backfill verify/checkpoint
 * or the live poll). Returns the number of internal-tx rows inserted.
 */
export async function indexBlockInternalTransactions(
  blockNumber: bigint,
  timestamp: Date
): Promise<{ count: number }> {
  try {
    const trace = await getBlockTrace(blockNumber);
    if (!Array.isArray(trace)) return { count: 0 };

    const allRows: InternalTransactionRow[] = [];
    for (const entry of trace as Array<Record<string, unknown>>) {
      if (!entry || typeof entry !== "object") continue;
      const txHash =
        (entry.txHash as string | undefined) ??
        (entry.transactionHash as string | undefined);
      const frame = entry.result ?? entry.trace;
      if (typeof txHash !== "string" || !frame) continue;
      const rows = decodeCallTracer(frame, {
        txHash: txHash.toLowerCase(),
        blockNumber,
        timestamp,
      });
      if (rows.length > 0) allRows.push(...rows);
    }

    if (allRows.length === 0) return { count: 0 };
    return await saveInternalTransactions(allRows);
  } catch (err) {
    console.error(
      `[internal-tx] failed to index internal txns for block ${blockNumber}:`,
      err
    );
    return { count: 0 };
  }
}
