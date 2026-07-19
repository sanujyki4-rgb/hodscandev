/**
 * Shared constants for Robinhood Chain across indexer, api, and web.
 * Values verified directly against the public mainnet RPC (chain ID
 * confirmed via docs.robinhood.com/chain and live curl checks).
 */

export const ROBINHOOD_CHAIN_ID = 4663;
export const ROBINHOOD_TESTNET_CHAIN_ID = 46646;

/** Split comma / whitespace / newline separated env lists; drop empties. */
export function parseEnvList(value: string | undefined | null): string[] {
  if (!value) return [];
  return value
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Preserve order; drop exact and trailing-slash duplicates. */
export function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const key = raw.replace(/\/+$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}

/**
 * Build Alchemy HTTPS endpoints from API keys (or pass-through full URLs).
 * Network is the Alchemy subdomain, e.g. "eth-mainnet".
 */
export function alchemyUrlsFromKeys(
  keys: string[],
  network: string
): string[] {
  const net = network.trim();
  if (!net || keys.length === 0) return [];
  return keys.map((key) => {
    if (key.startsWith("http://") || key.startsWith("https://")) return key;
    return `https://${net}.g.alchemy.com/v2/${key}`;
  });
}

/**
 * Merge ordered URL sources (first wins for preference / round-robin start).
 * Empty sources are ignored.
 */
export function mergeRpcUrls(...sources: Array<string[] | undefined>): string[] {
  const merged: string[] = [];
  for (const src of sources) {
    if (src?.length) merged.push(...src);
  }
  return dedupeUrls(merged);
}

/**
 * Redact API keys in RPC URLs for safe logging (Alchemy /v2/KEY → /v2/*** ).
 */
export function redactRpcUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/v2\/[^/]+/i, "/v2/***");
    return `${u.origin}${path}${u.search ? "?***" : ""}`;
  } catch {
    return "(invalid-rpc-url)";
  }
}

// ---------------------------------------------------------------------------
// L2 (Robinhood Chain) RPC — multi-endpoint
//
// Sources (merged, first listed = preferred start of round-robin):
//   1. RH_RPC_URLS              comma-separated full URLs (any provider)
//   2. RH_RPC_URL_MAINNET       single URL (backward compatible)
//   3. ALCHEMY_L2_API_KEYS      + ALCHEMY_L2_NETWORK → Alchemy URLs
// Fallback default: public Robinhood mainnet RPC.
// ---------------------------------------------------------------------------

const DEFAULT_L2_RPC = "https://rpc.mainnet.chain.robinhood.com";

const alchemyL2Network =
  process.env.ALCHEMY_L2_NETWORK?.trim() ||
  process.env.ALCHEMY_RH_NETWORK?.trim() ||
  "";

export const L2_RPC_URLS: string[] = (() => {
  const urls = mergeRpcUrls(
    parseEnvList(process.env.RH_RPC_URLS),
    parseEnvList(process.env.RH_RPC_URL_MAINNET),
    alchemyUrlsFromKeys(
      parseEnvList(process.env.ALCHEMY_L2_API_KEYS),
      alchemyL2Network
    )
  );
  return urls.length > 0 ? urls : [DEFAULT_L2_RPC];
})();

/** First L2 URL — backward-compatible single-URL export. */
export const RPC_URL_MAINNET = L2_RPC_URLS[0] ?? DEFAULT_L2_RPC;

export const RPC_URL_TESTNET =
  process.env.RH_RPC_URL_TESTNET ?? "https://rpc.testnet.chain.robinhood.com";

export const BLOCK_EXPLORER_URL = "https://robinhoodchain.blockscout.com";

// --- L1 (Ethereum mainnet) config, used only for indexing L1->L2
// retryable-ticket messages (see L1ToL2Message in the Prisma schema).
// Addresses verified against docs.robinhood.com/chain/protocol-contracts.
export const L1_CHAIN_ID = 1;
export const L1_BRIDGE_ADDRESS = "0xDf8755334ce7A73cCF6b581C02eA649AE3E864b3";
export const L1_DELAYED_INBOX_ADDRESS = "0x1A07cc4BD17E0118BdB54D70990D2158AbAD7a2D";
export const L1_SEQUENCER_INBOX_ADDRESS = "0xBd0D173EEb87D57A09521c24388a12789F33ba96";
export const L1_OUTBOX_ADDRESS = "0xf0ce991ea4A0d2400A4AB49b20ae333f6Dce3DE9";
export const L1_ROLLUP_ADDRESS = "0x23A19d23e89166adedbDcB432518AB01e4272D94";

// ---------------------------------------------------------------------------
// L1 (Ethereum) RPC — multi-endpoint
//
// Sources:
//   1. L1_RPC_URLS              comma-separated full URLs
//   2. L1_RPC_URL_MAINNET       single URL (backward compatible)
//   3. ALCHEMY_L1_API_KEYS      → https://eth-mainnet.g.alchemy.com/v2/{key}
// No public default (L1 needs a real provider). Empty list disables L1 jobs.
// ---------------------------------------------------------------------------

const alchemyL1Network =
  process.env.ALCHEMY_L1_NETWORK?.trim() || "eth-mainnet";

export const L1_RPC_URLS: string[] = mergeRpcUrls(
  parseEnvList(process.env.L1_RPC_URLS),
  parseEnvList(process.env.L1_RPC_URL_MAINNET),
  alchemyUrlsFromKeys(
    parseEnvList(process.env.ALCHEMY_L1_API_KEYS),
    alchemyL1Network
  )
);

/** First L1 URL (or "") — backward-compatible single-URL export. */
export const L1_RPC_URL_MAINNET = L1_RPC_URLS[0] ?? "";

// How often the indexer polls for new blocks, in milliseconds.
// Robinhood Chain block time is ~100ms; we poll less aggressively
// than that to avoid hammering the public RPC (rate-limited).
export const INDEXER_POLL_INTERVAL_MS = Number(
  process.env.INDEXER_POLL_INTERVAL_MS ?? 500
);

// Etherscan/Arbiscan cap their global list pages to the most recent
// ~500k records ("Showing the last 500k records"). We mirror that: it
// bounds count(*) and deep-offset costs to at most this many rows.
export const EXPLORER_LIST_CAP = Number(
  process.env.EXPLORER_LIST_CAP ?? 500000
);

// Receipt backfill (jobs/backfillReceipts.ts): blocks scanned per pass
// and pause between blocks. Conservative because the public RPC is
// rate-limited; raise batch / lower delay on your own node.
export const RECEIPT_BACKFILL_BATCH_BLOCKS = Number(
  process.env.RECEIPT_BACKFILL_BATCH_BLOCKS ?? 25
);
export const RECEIPT_BACKFILL_DELAY_MS = Number(
  process.env.RECEIPT_BACKFILL_DELAY_MS ?? 200
);

// ---------------------------------------------------------------------------
// Capability-aware multi-provider RPC (packages/rpc/src/providerRoles.ts)
//
// Robinhood Chain has no single RPC that is both cheap AND full-featured, so
// we split traffic across three providers by capability ("role"):
//
//   ZAN       role "bulk"    → eth_getBlockByNumber / eth_getBlockReceipts /
//                              eth_getLogs over large ranges (up to 10k blocks).
//                              Highest monthly quota. Blocks debug_trace* on the
//                              free tier, so it must NEVER be used for traces.
//   Uniblock  role "trace"   → debug_traceBlockByNumber / debug_traceTransaction
//             + "primary"       / debug_traceCall (ZAN can't do these) and the
//                              general-purpose primary for everything else.
//                              Requires an "X-API-KEY" header (UNIBLOCK_API_KEY).
//   QuickNode role "fallback"→ last resort only. Its eth_getLogs is capped at a
//                              5-block range, so it must NEVER be used for large
//                              log ranges.
//
// Each provider is configured from env. Values are comma/whitespace separated
// URL lists (parseEnvList) so a single provider can still have >1 endpoint.
//   ZAN_RPC_URLS            e.g. https://api.zan.top/node/v1/rh/mainnet/KEY
//   UNIBLOCK_RPC_URLS       e.g. https://rpc.uniblock.dev/... (needs API key)
//   UNIBLOCK_API_KEY        sent as the "X-API-KEY" header (NEVER inline it)
//   QUICKNODE_RPC_URLS      e.g. https://xxx.quiknode.pro/KEY/
//
// Any provider with no configured URL is simply skipped. If NONE are set the
// router falls back to L2_RPC_URLS (the public/default RPC) as a single
// "primary+bulk+fallback" provider so local dev still works.
// ---------------------------------------------------------------------------

export const ZAN_RPC_URLS: string[] = parseEnvList(process.env.ZAN_RPC_URLS);

export const UNIBLOCK_RPC_URLS: string[] = parseEnvList(
  process.env.UNIBLOCK_RPC_URLS
);

/** Uniblock requires this in an "X-API-KEY" request header. Never inlined. */
export const UNIBLOCK_API_KEY: string =
  process.env.UNIBLOCK_API_KEY?.trim() ?? "";

export const QUICKNODE_RPC_URLS: string[] = parseEnvList(
  process.env.QUICKNODE_RPC_URLS
);

// Largest block range we let the bulk provider (ZAN) request in a single
// eth_getLogs / range call. QuickNode is capped far lower (see below).
export const ZAN_MAX_LOG_RANGE_BLOCKS = Number(
  process.env.ZAN_MAX_LOG_RANGE_BLOCKS ?? 10_000
);

// QuickNode's eth_getLogs is limited to a 5-block window — the router uses
// this to refuse routing large log ranges to the fallback provider.
export const QUICKNODE_MAX_LOG_RANGE_BLOCKS = Number(
  process.env.QUICKNODE_MAX_LOG_RANGE_BLOCKS ?? 5
);

// ---------------------------------------------------------------------------
// Gapless backfill orchestrator (apps/indexer/src/jobs/backfillGapless.ts)
//
// Iterates a contiguous block range (optionally latest→oldest) with a
// persisted checkpoint, per-block verify, and a failed-block retry queue.
//   BACKFILL_START_BLOCK   inclusive range start (default: chain head)
//   BACKFILL_END_BLOCK     inclusive range end   (default: 0)
//   BACKFILL_DIRECTION     "reverse" (latest→oldest, default) | "forward"
//   BACKFILL_DELAY_MS      throttle between blocks (default 100ms)
// ---------------------------------------------------------------------------

export const BACKFILL_DELAY_MS = Number(process.env.BACKFILL_DELAY_MS ?? 100);
