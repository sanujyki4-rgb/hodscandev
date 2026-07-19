import {
  ZAN_RPC_URLS,
  UNIBLOCK_RPC_URLS,
  UNIBLOCK_API_KEY,
  QUICKNODE_RPC_URLS,
  QUICKNODE_MAX_LOG_RANGE_BLOCKS,
  L2_RPC_URLS,
  redactRpcUrl,
} from "@hoodscan/config";

/**
 * Capability-aware multi-provider JSON-RPC router for Robinhood Chain.
 *
 * -----------------------------------------------------------------------------
 * WHY (kenapa) this exists
 * -----------------------------------------------------------------------------
 * No single Robinhood Chain RPC is both cheap AND full-featured, so we split
 * traffic across providers by capability ("role"). This module owns:
 *   1. provider role config read from env/@hoodscan/config,
 *   2. a method→role routing table, and
 *   3. `sendRpc(method, params, { roleHint? })` — a sender that picks eligible
 *      providers by role, tries them in order, retries with exponential
 *      backoff, and fails over to the next provider on error / rate-limit.
 *
 * Provider roles (agreed strategy for Robinhood Chain):
 *   ZAN       → "bulk"   : eth_getBlockByNumber / eth_getBlockReceipts /
 *                          eth_getLogs over large ranges. Highest quota.
 *                          NEVER used for debug_trace* (blocked on free tier).
 *   Uniblock  → "trace"  : debug_traceBlockByNumber / debug_traceTransaction /
 *               + "primary" debug_traceCall, plus the general-purpose primary.
 *                          Requires the "X-API-KEY" header (UNIBLOCK_API_KEY).
 *   QuickNode → "fallback": last resort only. Its eth_getLogs is limited to a
 *                          5-block range, so it is skipped for large log ranges.
 * -----------------------------------------------------------------------------
 */

/** The capability tags a provider can carry. */
export type ProviderRole = "bulk" | "trace" | "primary" | "fallback";

export type ProviderConfig = {
  /** Stable id for logs, e.g. "zan". */
  id: string;
  /** Configured endpoint URLs (one provider may have several). */
  urls: string[];
  /** Capability tags this provider satisfies. */
  roles: ProviderRole[];
  /** Extra headers to send (e.g. Uniblock's X-API-KEY). */
  headers?: Record<string, string>;
  /**
   * Hard limits used by the router to refuse unsafe routes. Currently only
   * the eth_getLogs / range-scan block window is enforced.
   */
  maxLogRangeBlocks?: number;
};

/**
 * Build the provider list from env/config. Providers with no configured URL
 * are skipped entirely. If NONE are configured we degrade gracefully to the
 * public/default L2 RPC (L2_RPC_URLS) as a single all-roles provider so local
 * development still works without any provider keys.
 */
function buildProviders(): ProviderConfig[] {
  const providers: ProviderConfig[] = [];

  // ZAN — bulk workhorse (blocks / receipts / large log ranges). Explicitly
  // NOT tagged "trace": ZAN blocks debug_trace* on the free tier.
  if (ZAN_RPC_URLS.length > 0) {
    providers.push({
      id: "zan",
      urls: ZAN_RPC_URLS,
      roles: ["bulk"],
    });
  }

  // Uniblock — trace-capable AND general primary. Needs the X-API-KEY header.
  if (UNIBLOCK_RPC_URLS.length > 0) {
    providers.push({
      id: "uniblock",
      urls: UNIBLOCK_RPC_URLS,
      roles: ["trace", "primary"],
      headers: UNIBLOCK_API_KEY ? { "X-API-KEY": UNIBLOCK_API_KEY } : undefined,
    });
  }

  // QuickNode — fallback of last resort. Small eth_getLogs window (5 blocks),
  // so the router never sends large log ranges here.
  if (QUICKNODE_RPC_URLS.length > 0) {
    providers.push({
      id: "quicknode",
      urls: QUICKNODE_RPC_URLS,
      roles: ["fallback"],
      maxLogRangeBlocks: QUICKNODE_MAX_LOG_RANGE_BLOCKS,
    });
  }

  // Degrade gracefully: nothing configured → use the public default RPC for
  // every role so the indexer still runs locally.
  if (providers.length === 0) {
    providers.push({
      id: "default-l2",
      urls: L2_RPC_URLS,
      roles: ["bulk", "primary", "trace", "fallback"],
    });
  }

  return providers;
}

/** Memoized provider list (env is read once at module load, like L2_RPC_URLS). */
const PROVIDERS: ProviderConfig[] = buildProviders();

/**
 * Method → ordered role preference. First matching provider wins; on failure
 * the router moves to the next role, then the next provider within a role.
 *
 *   block / receipts / logs  → bulk (ZAN) → primary (Uniblock) → fallback
 *   debug_trace*             → trace (Uniblock) → fallback (QuickNode). NEVER ZAN.
 *   everything else          → primary (Uniblock) → bulk → fallback
 */
const BULK_ROLE_ORDER: ProviderRole[] = ["bulk", "primary", "fallback"];
const TRACE_ROLE_ORDER: ProviderRole[] = ["trace", "fallback"];
const DEFAULT_ROLE_ORDER: ProviderRole[] = ["primary", "bulk", "fallback"];

/** Exact method names that must use the bulk path. */
const BULK_METHODS = new Set<string>([
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getBlockReceipts",
  "eth_getLogs",
  "eth_getBlockTransactionCountByNumber",
  "eth_getBlockTransactionCountByHash",
]);

/**
 * Resolve the ordered list of roles to try for a method. A caller can override
 * with `roleHint` (e.g. force "trace" for an on-demand trace fetch).
 */
export function rolesForMethod(
  method: string,
  roleHint?: ProviderRole
): ProviderRole[] {
  if (roleHint) {
    // Honour the hint first, then fall back through the remaining roles so a
    // hinted call still degrades instead of hard-failing.
    const rest = DEFAULT_ROLE_ORDER.filter((r) => r !== roleHint);
    return [roleHint, ...rest];
  }

  if (method.startsWith("debug_trace")) return TRACE_ROLE_ORDER;
  if (BULK_METHODS.has(method)) return BULK_ROLE_ORDER;
  return DEFAULT_ROLE_ORDER;
}

/**
 * Ordered, de-duplicated list of providers to attempt for a given role order.
 * A provider that satisfies more than one role only appears once (first hit).
 */
function eligibleProviders(roleOrder: ProviderRole[]): ProviderConfig[] {
  const seen = new Set<string>();
  const out: ProviderConfig[] = [];
  for (const role of roleOrder) {
    for (const p of PROVIDERS) {
      if (p.roles.includes(role) && !seen.has(p.id)) {
        seen.add(p.id);
        out.push(p);
      }
    }
  }
  return out;
}

export type SendRpcOptions = {
  /** Force a specific role first (e.g. "trace" for on-demand traces). */
  roleHint?: ProviderRole;
  /** Attempts per provider URL before failing over (default 3). */
  retriesPerUrl?: number;
  /** Base backoff in ms; doubles each retry (default 250). */
  backoffMs?: number;
  /** Per-request timeout in ms (default 15_000). */
  timeoutMs?: number;
  /**
   * For range methods (eth_getLogs), the number of blocks spanned. The router
   * skips providers whose maxLogRangeBlocks is smaller (e.g. QuickNode's 5).
   */
  logRangeBlocks?: number;
};

/** Shape of a JSON-RPC 2.0 response. */
type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

let rpcId = 0;
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/**
 * A JSON-RPC error surfaced from a provider (result had an `error` object).
 * Carries the RPC error code so callers/backoff can react to rate limits.
 */
export class RpcError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly data?: unknown
  ) {
    super(message);
    this.name = "RpcError";
  }
}

/**
 * Heuristic: is this error worth failing over / retrying? Rate limits (HTTP
 * 429 or the -32005 / "rate limit" RPC error), timeouts, and transient 5xx /
 * network errors are retryable. A deterministic "method not found" (-32601)
 * — e.g. ZAN refusing debug_trace* — is NOT retryable on the same provider,
 * but IS a signal to fail over to the next eligible provider, which the
 * outer loop handles by moving on.
 */
function isRetryable(err: unknown): boolean {
  if (err instanceof RpcError) {
    // -32005 = limit exceeded (common rate-limit code); -32000 = generic server
    if (err.code === -32005 || err.code === -32000) return true;
    if (/rate|limit|timeout|temporarily/i.test(err.message)) return true;
    return false;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /429|timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|5\d\d/i.test(
    msg
  );
}

/**
 * Low-level single-URL JSON-RPC POST via fetch. Throws RpcError on a JSON-RPC
 * error, or a plain Error on HTTP/transport failure (429 included in message).
 */
async function postJsonRpc(
  url: string,
  method: string,
  params: unknown[],
  headers: Record<string, string> | undefined,
  timeoutMs: number
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(headers ?? {}) },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++rpcId,
        method,
        params,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      // Surface the status so isRetryable() can spot 429 / 5xx.
      throw new Error(`HTTP ${res.status} from ${redactRpcUrl(url)}`);
    }

    const json = (await res.json()) as JsonRpcResponse;
    if (json.error) {
      throw new RpcError(json.error.message, json.error.code, json.error.data);
    }
    return json.result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Capability-aware JSON-RPC sender.
 *
 * Routing: `rolesForMethod(method, roleHint)` decides the role order; the
 * router then walks eligible providers in that order. For each provider it
 * retries each URL up to `retriesPerUrl` times with exponential backoff, and
 * on exhausting the retries (or hitting a non-retryable error) fails over to
 * the NEXT provider. Only when every eligible provider is exhausted does it
 * throw the last observed error.
 *
 * Safety: eth_getLogs (and other range scans) carry an optional
 * `logRangeBlocks`; providers whose `maxLogRangeBlocks` is smaller are skipped
 * so we never send a 10k-block range to QuickNode's 5-block window.
 */
export async function sendRpc<T = unknown>(
  method: string,
  params: unknown[] = [],
  options: SendRpcOptions = {}
): Promise<T> {
  const {
    roleHint,
    retriesPerUrl = 3,
    backoffMs = 250,
    timeoutMs = 15_000,
    logRangeBlocks,
  } = options;

  const roleOrder = rolesForMethod(method, roleHint);
  const providers = eligibleProviders(roleOrder);

  if (providers.length === 0) {
    throw new Error(
      `sendRpc: no eligible provider for method ${method} ` +
        `(roles tried: ${roleOrder.join(", ")})`
    );
  }

  let lastError: unknown;

  for (const provider of providers) {
    // Skip a provider whose log-range window is too small for this call.
    if (
      method === "eth_getLogs" &&
      logRangeBlocks !== undefined &&
      provider.maxLogRangeBlocks !== undefined &&
      logRangeBlocks > provider.maxLogRangeBlocks
    ) {
      continue;
    }

    for (const url of provider.urls) {
      for (let attempt = 0; attempt < retriesPerUrl; attempt++) {
        try {
          return (await postJsonRpc(
            url,
            method,
            params,
            provider.headers,
            timeoutMs
          )) as T;
        } catch (err) {
          lastError = err;
          // Non-retryable on this provider → stop retrying this URL and let the
          // outer loop fail over to the next provider (handles ZAN refusing
          // debug_trace* with method-not-found, etc.).
          if (!isRetryable(err)) break;
          // Exponential backoff before the next attempt on the same URL.
          if (attempt < retriesPerUrl - 1) {
            await sleep(backoffMs * 2 ** attempt);
          }
        }
      }
    }
  }

  throw (
    lastError ??
    new Error(
      `sendRpc: all providers failed for ${method} ` +
        `(roles: ${roleOrder.join(", ")})`
    )
  );
}

/** Human-readable summary of the configured providers (secrets redacted). */
export function describeProviders(): string {
  return PROVIDERS.map(
    (p) =>
      `${p.id}[${p.roles.join("+")}] ` +
      `(${p.urls.map((u) => redactRpcUrl(u)).join(", ")})`
  ).join(" | ");
}

/** Read-only view of the configured providers (for logging / tests). */
export function listProviders(): ProviderConfig[] {
  return PROVIDERS.map((p) => ({ ...p, urls: [...p.urls], roles: [...p.roles] }));
}
