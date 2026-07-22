/**
 * On-chain ERC-20 token metadata resolver (name / symbol / decimals).
 *
 * Self-reliant: talks ONLY to the user's own Robinhood Chain RPC node
 * (no Blockscout / OpenChain / CoinGecko / external APIs). Mirrors the
 * viem client pattern and caching philosophy of
 * apps/api/src/utils/contractType.ts.
 *
 * This is Layer 1 — the foundation. It is consumed by token-transfer
 * asset display (Layer 2) and the future token transfers tab (Layer 3).
 */
import { hexToString } from "viem";
import { redis } from "../middlewares/cache";
import { rpcClient } from "./rpcClient";
import { isContractAddress } from "./isContract";

/**
 * Minimal ERC-20 metadata ABI. name()/symbol() return string on modern
 * tokens; a separate bytes32 variant is used as a fallback for legacy
 * tokens (e.g. MKR) that return bytes32 instead.
 */
const ERC20_STRING_ABI = [
  {
    name: "name",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

const ERC20_BYTES32_ABI = [
  {
    name: "name",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
] as const;

const ERC20_DECIMALS_ABI = [
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;

const CACHE_PREFIX = "hoodscan:token:";
const TTL_RESOLVED = 60 * 60 * 24 * 30; // 30 days — at least symbol or name found
const TTL_EMPTY = 60 * 60 * 24; // 1 day — fully-empty/failed, re-check occasionally

export type TokenMetadata = {
  name: string | null;
  symbol: string | null;
  decimals: number | null;
};

// Max lengths for cached metadata, mirroring the indexer's clampTokenMeta so
// both metadata paths (DB + Redis) agree on what's storable.
const NAME_MAX = 256;
const SYMBOL_MAX = 128;

/**
 * Sanitize a decoded on-chain string: strip NUL + C0/C1 control chars (the
 * source of garbage "\u0000..." values, and unsafe for Postgres/JSON), trim,
 * and clamp to a sane length. Returns null when nothing usable remains.
 * Mirrors the indexer's sanitizeUtf8 + clampTokenMeta.
 */
function sanitizeMeta(value: string, maxLen: number): string | null {
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned) return null;
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

/**
 * Decode a bytes32 value into a sanitized UTF-8 string. Returns null if the
 * value is empty/undecodable.
 */
function decodeBytes32(value: `0x${string}`): string | null {
  try {
    return sanitizeMeta(hexToString(value), NAME_MAX);
  } catch {
    return null;
  }
}

/**
 * Read a string-typed metadata field (name/symbol). Attempts the string
 * variant first; on failure falls back to a bytes32 variant (legacy
 * tokens like MKR). Best-effort — returns null if both fail.
 */
async function readStringField(
  address: `0x${string}`,
  functionName: "name" | "symbol"
): Promise<string | null> {
  try {
    const result = await rpcClient.readContract({
      address,
      abi: ERC20_STRING_ABI,
      functionName,
    });
    // Sanitize + clamp (see sanitizeMeta): strips the NUL/control chars some
    // contracts return via a bytes32-style value, which would otherwise be
    // cached as a garbage "\u0000..." name. Empty result -> null.
    const maxLen = functionName === "symbol" ? SYMBOL_MAX : NAME_MAX;
    return sanitizeMeta(result as string, maxLen);
  } catch {
    /* fall through to bytes32 variant */
  }

  try {
    const result = await rpcClient.readContract({
      address,
      abi: ERC20_BYTES32_ABI,
      functionName,
    });
    return decodeBytes32(result as `0x${string}`);
  } catch {
    return null;
  }
}

/** Read decimals() as a number. Best-effort — returns null on failure. */
async function readDecimals(address: `0x${string}`): Promise<number | null> {
  try {
    const result = await rpcClient.readContract({
      address,
      abi: ERC20_DECIMALS_ABI,
      functionName: "decimals",
    });
    return Number(result);
  } catch {
    return null;
  }
}

/**
 * Safely parse a cached JSON metadata blob back into TokenMetadata.
 * Returns null if the blob is malformed.
 */
function fromCache(cached: string): TokenMetadata | null {
  try {
    const parsed = JSON.parse(cached);
    return {
      name: typeof parsed?.name === "string" ? parsed.name : null,
      symbol: typeof parsed?.symbol === "string" ? parsed.symbol : null,
      decimals: typeof parsed?.decimals === "number" ? parsed.decimals : null,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve an ERC-20 token's on-chain metadata.
 *
 * - Normalizes the address to lowercase; returns null for empty/nullish.
 * - Reads a Redis cache first (hoodscan:token:<address>); on hit, parses
 *   and returns the stored JSON.
 * - When `allowRemote` is false and there's no cache hit, returns null
 *   WITHOUT making any on-chain call — this keeps list endpoints fast
 *   and non-blocking. The detail view (allowRemote=true) does the live
 *   reads and caches the result for later list requests.
 *
 * Always best-effort: never throws out of this function.
 */
export async function getTokenMetadata(
  address: string | null | undefined,
  allowRemote = false
): Promise<TokenMetadata | null> {
  const addr = (address ?? "").trim().toLowerCase();
  if (!addr) return null;

  const key = CACHE_PREFIX + addr;

  // 1. Cache read (best-effort).
  try {
    const cached = await redis.get(key);
    if (cached !== null) {
      const parsed = fromCache(cached);
      if (parsed !== null) {
        // Fast path: fully-complete entry — nothing to heal.
        if (
          parsed.name !== null &&
          parsed.symbol !== null &&
          parsed.decimals !== null
        ) {
          return parsed;
        }

        // Something is missing (name, symbol, and/or decimals). On the
        // list path (allowRemote=false) we stay fast/non-blocking and
        // return the partial as-is. On the detail path we self-heal.
        if (!allowRemote) return parsed;

        // Self-heal ALL missing fields — not just decimals. A transient
        // RPC miss on symbol()/name() must never stay frozen while the
        // contract actually exposes the value on-chain (the real cause of
        // "null symbol" tokens). Re-read only the fields that are null.
        const [rName, rSymbol, rDecimals] = await Promise.all([
          parsed.name === null
            ? readStringField(addr as `0x${string}`, "name")
            : Promise.resolve(parsed.name),
          parsed.symbol === null
            ? readStringField(addr as `0x${string}`, "symbol")
            : Promise.resolve(parsed.symbol),
          parsed.decimals === null
            ? readDecimals(addr as `0x${string}`)
            : Promise.resolve(parsed.decimals),
        ]);

        // Merge: a freshly-read value only ever FILLS a null; it can never
        // downgrade an existing good value back to null.
        const healed: TokenMetadata = {
          name: rName ?? parsed.name,
          symbol: rSymbol ?? parsed.symbol,
          decimals: rDecimals ?? parsed.decimals,
        };

        // Only rewrite the cache when something actually improved (avoids
        // resetting TTL / looping when a field is genuinely unavailable).
        const improved =
          healed.name !== parsed.name ||
          healed.symbol !== parsed.symbol ||
          healed.decimals !== parsed.decimals;
        if (improved) {
          try {
            const resolved = healed.name !== null && healed.symbol !== null;
            await redis.set(
              key,
              JSON.stringify(healed),
              "EX",
              resolved ? TTL_RESOLVED : TTL_EMPTY
            );
          } catch {
            /* ignore cache write failures */
          }
        }
        return healed;
      }
      // Malformed cache entry — fall through and try to refresh.
    }
  } catch {
    /* cache is best-effort */
  }

  // 2. Cache miss. Don't block list endpoints with on-chain calls.
  if (!allowRemote) return null;

  // 2b. Skip non-contracts entirely. A regular wallet (EOA) has no
  //     name()/symbol()/decimals(), so resolving would only produce a
  //     null triple — which must NEVER be written under hoodscan:token:*.
  //     Only a definitive `false` (empty bytecode) short-circuits here;
  //     `null` (transient RPC failure) falls through so a real token is
  //     never dropped on a flaky read.
  if ((await isContractAddress(addr, true)) === false) {
    return { name: null, symbol: null, decimals: null };
  }

  // 3. Live on-chain reads against the user's own RPC node. Three
  //    individual best-effort reads (correctness over cleverness).
  const [name, symbol, decimals] = await Promise.all([
    readStringField(addr as `0x${string}`, "name"),
    readStringField(addr as `0x${string}`, "symbol"),
    readDecimals(addr as `0x${string}`),
  ]);

  const metadata: TokenMetadata = { name, symbol, decimals };

  // 4. Cache the result. Only a COMPLETE resolution (both name AND symbol)
  //    gets the long TTL; a partial/failed read is re-checked sooner so a
  //    transient RPC miss (e.g. symbol() briefly failing) can't freeze a null
  //    value for 30 days. decimals is separately self-healed on cache hit.
  try {
    const resolved = name !== null && symbol !== null;
    await redis.set(
      key,
      JSON.stringify(metadata),
      "EX",
      resolved ? TTL_RESOLVED : TTL_EMPTY
    );
  } catch {
    /* ignore cache write failures */
  }

  return metadata;
}
