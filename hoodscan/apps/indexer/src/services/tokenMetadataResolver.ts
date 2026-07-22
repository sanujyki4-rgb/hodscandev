import { prisma } from "@hoodscan/database";
import { sendRpc } from "@hoodscan/rpc";
import { fetchTokenLogoUrl } from "./tokenLogoResolver";
import { decodeAbiParameters, hexToString } from "viem";

/**
 * Layer 3 — LAZY, throttled ERC-20 metadata resolver.
 *
 * Fills the name / symbol / decimals / totalSupply columns on Token rows by
 * eth_call-ing the standard ERC-20 view methods. This is INTENTIONALLY off the
 * block-processing hot path and rate-limited (see resolvePendingTokenMetadata)
 * so it never burns through provider quota — the indexer creates bare Token
 * rows as it sees transfers, and this resolver backfills their metadata later.
 *
 * Routing: uses sendRpc's DEFAULT role (Uniblock → ZAN → QuickNode). We do NOT
 * force the "trace" role — these are plain eth_calls, not debug_trace*.
 */

/** 4-byte selectors for the standard ERC-20 metadata view methods. */
const SELECTOR = {
  name: "0x06fdde03",
  symbol: "0x95d89b41",
  decimals: "0x313ce567",
  totalSupply: "0x18160ddd",
} as const;

/**
 * eth_call a token contract with a 4-byte selector (no args) at "latest".
 * Returns the raw hex return data, or null on any failure (call reverts,
 * provider error, non-contract address, …) — callers treat null as "unknown".
 */
async function ethCall(address: string, data: string): Promise<string | null> {
  try {
    const result = await sendRpc<string | null>("eth_call", [
      { to: address, data },
      "latest",
    ]);
    if (!result || result === "0x") return null;
    return result;
  } catch {
    return null;
  }
}

/**
 * Sanitize a decoded on-chain string so Postgres (UTF-8 text) accepts it.
 * Postgres rejects NUL bytes (0x00) ANYWHERE in a text value with error 22021
 * ("invalid byte sequence for encoding UTF8: 0x00"). bytes32 names are
 * right-padded with 0x00 and some malformed tokens embed NULs mid-string, so
 * we strip ALL NULs (not just trailing) plus other C0 control chars, then trim.
 */
function sanitizeUtf8(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

/**
 * Decode an ABI-encoded string return, handling BOTH the modern dynamic
 * `string` encoding (offset + length + bytes) and the legacy `bytes32` form
 * some old tokens (e.g. MKR) use for name()/symbol(). Returns null if neither
 * decodes to anything usable.
 */
function decodeStringReturn(hex: string): string | null {
  if (!hex || hex === "0x") return null;

  // Try the standard dynamic-string ABI decode first.
  try {
    const [value] = decodeAbiParameters(
      [{ type: "string" }],
      hex as `0x${string}`
    );
    const str = sanitizeUtf8(value as string);
    if (str.length > 0) return str;
  } catch {
    // fall through to the bytes32 attempt
  }

  // Legacy bytes32: a single 32-byte word holding right-padded UTF-8 bytes.
  try {
    const body = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (body.length >= 64) {
      const word = ("0x" + body.slice(0, 64)) as `0x${string}`;
      const str = sanitizeUtf8(hexToString(word));
      if (str.length > 0) return str;
    }
  } catch {
    // give up — leave null
  }

  return null;
}

/** Decode a uint return (decimals: uint8, totalSupply: uint256). null on fail. */
function decodeUintReturn(hex: string | null): bigint | null {
  if (!hex || hex === "0x") return null;
  try {
    return BigInt(hex);
  } catch {
    return null;
  }
}

/**
 * Resolve and persist ERC-20 metadata for a single token address.
 *
 * Each of the four eth_calls is independently wrapped in try/catch (via
 * ethCall), so a token that implements some methods but not others still gets
 * its available fields filled; the rest stay null. Upserts the Token row so a
 * not-yet-seen address still gets a record.
 *
 * @param address 0x token contract address (lowercased)
 */
/**
 * Clamp on-chain string metadata (name/symbol) to a DB- and index-safe length.
 * Some tokens report absurdly long or junk name/symbol values (thousands of
 * bytes). The Token.symbol B-tree index caps an entry at ~8191 bytes, so an
 * unbounded value makes the entire upsert fail (Postgres error 54000 —
 * "index row requires N bytes, maximum size is 8191"). We also strip NUL
 * bytes, which Postgres text columns cannot store. Returns null when empty.
 */
function clampTokenMeta(value: string | null, maxLen: number): string | null {
  if (value == null) return null;
  const cleaned = value.replace(/\u0000/g, "").trim();
  if (!cleaned) return null;
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

export async function resolveTokenMetadata(address: string): Promise<boolean> {
  const token = address.toLowerCase();

  const [nameHex, symbolHex, decimalsHex, totalSupplyHex] = await Promise.all([
    ethCall(token, SELECTOR.name),
    ethCall(token, SELECTOR.symbol),
    ethCall(token, SELECTOR.decimals),
    ethCall(token, SELECTOR.totalSupply),
  ]);

  // Clamp to index-safe lengths: a token with a multi-KB name/symbol would
  // otherwise blow past the Token.symbol B-tree index limit and fail the upsert.
  const name = clampTokenMeta(nameHex ? decodeStringReturn(nameHex) : null, 256);
  const symbol = clampTokenMeta(symbolHex ? decodeStringReturn(symbolHex) : null, 128);

  const decimalsBig = decodeUintReturn(decimalsHex);
  const decimals =
    decimalsBig !== null && decimalsBig <= 255n ? Number(decimalsBig) : null;

  const totalSupplyBig = decodeUintReturn(totalSupplyHex);
  const totalSupply = totalSupplyBig !== null ? totalSupplyBig.toString() : null;

  // Also resolve the token logo from Blockscout (best-effort). null = leave
  // unchecked (transient) so a later pass / backfill retries it.
  const logoUrl = await fetchTokenLogoUrl(token);

  await prisma.token.upsert({
    where: { address: token },
    create: {
      address: token,
      tokenType: "erc20",
      name,
      symbol,
      decimals,
      totalSupply,
      ...(logoUrl !== null ? { logoUrl } : {}),
    },
    update: {
      name,
      symbol,
      decimals,
      totalSupply,
      ...(logoUrl !== null ? { logoUrl } : {}),
    },
  });

  // Report whether we actually got usable metadata (name or symbol). The
  // caller uses this to gauge provider health and drive adaptive backoff:
  // a batch that resolves NOTHING is a strong rate-limited/error signal.
  return Boolean(name || symbol);
}

/**
 * Batch entrypoint for a periodic operator/job: resolve metadata for Token
 * rows that don't have it yet (name IS NULL).
 *
 * INTENTIONALLY rate-limited to protect provider quota: it processes at most
 * `limit` tokens and sleeps `delayMs` between each token so a large backlog is
 * drained gradually across many invocations rather than in one RPC burst. Call
 * it on a schedule (cron / interval), not per block.
 *
 * @param limit   max number of tokens to resolve this pass (default 25)
 * @param delayMs delay between tokens in ms, for throttling (default 200)
 * @returns { processed, resolved } — tokens attempted and tokens that got metadata
 */
export async function resolvePendingTokenMetadata(
  limit = 25,
  delayMs = 200
): Promise<{ processed: number; resolved: number }> {
  const pending = await prisma.token.findMany({
    where: { name: null },
    take: limit,
    select: { address: true },
  });

  let processed = 0;
  let resolved = 0;
  for (const { address } of pending) {
    if (await resolveTokenMetadata(address)) resolved++;
    processed++;
    if (delayMs > 0 && processed < pending.length) {
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }

  return { processed, resolved };
}

/**
 * Count Token rows still missing metadata (name IS NULL). Cheap, indexed
 * count used by the adaptive scheduler to decide how aggressively to drain
 * the backlog (bigger batches + shorter interval when the queue is long,
 * slowing right down to an idle cadence once it's empty).
 *
 * @returns the number of tokens awaiting metadata resolution
 */
export async function countPendingTokenMetadata(): Promise<number> {
  return prisma.token.count({ where: { name: null } });
}
