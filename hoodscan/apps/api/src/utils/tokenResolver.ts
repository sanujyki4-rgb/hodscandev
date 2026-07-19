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
import { createPublicClient, http, defineChain, hexToString } from "viem";
import { RPC_URL_MAINNET, ROBINHOOD_CHAIN_ID } from "@hoodscan/config";
import { redis } from "../middlewares/cache";

/**
 * Robinhood Chain mainnet definition for viem — same shape as
 * contractType.ts so both read chain state identically.
 */
const robinhoodChain = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL_MAINNET] },
  },
});

/**
 * Read-only viem public client. Conservative retries/timeout so a slow
 * RPC can't cascade into a request storm on the detail endpoint.
 */
const rpcClient = createPublicClient({
  chain: robinhoodChain,
  transport: http(RPC_URL_MAINNET, {
    retryCount: 1,
    retryDelay: 300,
    timeout: 3_000,
  }),
});

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

/**
 * Decode a bytes32 value into a trimmed UTF-8 string, stripping trailing
 * null bytes. Returns null if the value is empty/undecodable.
 */
function decodeBytes32(value: `0x${string}`): string | null {
  try {
    const decoded = hexToString(value).replace(/\u0000+$/g, "").trim();
    return decoded.length > 0 ? decoded : null;
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
    const str = (result as string).trim();
    return str.length > 0 ? str : null;
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
      if (parsed !== null) return parsed;
      // Malformed cache entry — fall through and try to refresh.
    }
  } catch {
    /* cache is best-effort */
  }

  // 2. Cache miss. Don't block list endpoints with on-chain calls.
  if (!allowRemote) return null;

  // 3. Live on-chain reads against the user's own RPC node. Three
  //    individual best-effort reads (correctness over cleverness).
  const [name, symbol, decimals] = await Promise.all([
    readStringField(addr as `0x${string}`, "name"),
    readStringField(addr as `0x${string}`, "symbol"),
    readDecimals(addr as `0x${string}`),
  ]);

  const metadata: TokenMetadata = { name, symbol, decimals };

  // 4. Cache the result. A resolution with at least a symbol or name
  //    lives long; a fully-empty/failed result is re-checked sooner (the
  //    contract may not have been deployed yet, or the RPC may have been
  //    briefly unavailable).
  try {
    const resolved = name !== null || symbol !== null;
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
