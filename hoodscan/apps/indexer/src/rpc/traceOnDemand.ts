import { sendRpc } from "@hoodscan/rpc";

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
 * @param txHash 0x-prefixed transaction hash
 * @param config optional tracer config (defaults to callTracer)
 */
export async function getTransactionTrace(
  txHash: string,
  config: TraceConfig = DEFAULT_TRACE_CONFIG
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
