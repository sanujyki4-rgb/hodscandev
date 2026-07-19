/**
 * On-chain contract-type detection via ERC-165 supportsInterface,
 * used to disambiguate ambiguous method selectors (notably
 * transferFrom / 0x23b872dd, which ERC-20 and ERC-721 share).
 *
 * Self-reliant: talks ONLY to the user's own Robinhood Chain RPC node
 * (no Blockscout / OpenChain / external APIs). Mirrors the viem client
 * pattern in apps/indexer/src/rpc/client.ts and the caching philosophy
 * of apps/api/src/utils/methodResolver.ts.
 */
import { createPublicClient, http, defineChain } from "viem";
import { RPC_URL_MAINNET, ROBINHOOD_CHAIN_ID } from "@hoodscan/config";
import { redis } from "../middlewares/cache";

/**
 * Robinhood Chain mainnet definition for viem — same shape as the
 * indexer's client so both apps read chain state identically.
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

/** Minimal ERC-165 ABI — only the one method we need. */
const SUPPORTS_INTERFACE_ABI = [
  {
    name: "supportsInterface",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "interfaceId", type: "bytes4" }],
    outputs: [{ type: "bool" }],
  },
] as const;

// ERC-165 interface ids.
const ERC721_INTERFACE_ID = "0x80ac58cd";
const ERC1155_INTERFACE_ID = "0xd9b67a26";

const CACHE_PREFIX = "hoodscan:ctype:";
const TTL_DEFINITE = 60 * 60 * 24 * 30; // 30 days for a confident erc721/erc1155
const TTL_OTHER = 60 * 60 * 24; // 1 day for "other"/unknown — re-check occasionally

export type ContractType = "erc721" | "erc1155" | "erc20" | "other";

/**
 * Map a Redis-cached string back to a ContractType. The "" sentinel
 * means "unknown/other".
 */
function fromCache(cached: string): ContractType {
  if (cached === "erc721" || cached === "erc1155" || cached === "erc20") {
    return cached;
  }
  return "other";
}

/**
 * Ask the contract whether it advertises `interfaceId` via ERC-165.
 * Contracts that don't implement ERC-165 revert — callers treat any
 * throw/false as "not this interface". Best-effort; never rethrows.
 */
async function supports(address: `0x${string}`, interfaceId: string): Promise<boolean> {
  try {
    const result = await rpcClient.readContract({
      address,
      abi: SUPPORTS_INTERFACE_ABI,
      functionName: "supportsInterface",
      args: [interfaceId as `0x${string}`],
    });
    return result === true;
  } catch {
    return false;
  }
}

/**
 * Determine a contract's token type.
 *
 * - Normalizes the address to lowercase; returns null for empty/nullish.
 * - Reads a Redis cache first (hoodscan:ctype:<address>); a cached ""
 *   sentinel means "unknown/other".
 * - When `allowRemote` is false and there's no cache hit, returns null
 *   WITHOUT making any on-chain call — this keeps list endpoints fast
 *   and non-blocking. The detail view (allowRemote=true) does the live
 *   ERC-165 probe and caches the result for later list requests.
 *
 * Always best-effort: never throws out of this function.
 */
export async function getContractType(
  address: string | null | undefined,
  allowRemote = false
): Promise<ContractType | null> {
  const addr = (address ?? "").trim().toLowerCase();
  if (!addr) return null;

  const key = CACHE_PREFIX + addr;

  // 1. Cache read (best-effort).
  try {
    const cached = await redis.get(key);
    if (cached !== null) {
      // "" sentinel -> "other".
      return fromCache(cached);
    }
  } catch {
    /* cache is best-effort */
  }

  // 2. Cache miss. Don't block list endpoints with on-chain calls.
  if (!allowRemote) return null;

  // 3. Live ERC-165 probe against the user's own RPC node.
  let type: ContractType = "other";
  try {
    if (await supports(addr as `0x${string}`, ERC721_INTERFACE_ID)) {
      type = "erc721";
    } else if (await supports(addr as `0x${string}`, ERC1155_INTERFACE_ID)) {
      type = "erc1155";
    } else {
      // Not an ERC-165 NFT — could be ERC-20 or a non-token contract.
      // We don't need to positively prove ERC-20 for the transferFrom
      // disambiguation, so leave it as "other".
      type = "other";
    }
  } catch {
    type = "other";
  }

  // 4. Cache the result. Definite NFT answers live long; "other" is
  //    re-checked sooner (a contract may not have been deployed yet, or
  //    the RPC may have been briefly unavailable).
  try {
    const definite = type === "erc721" || type === "erc1155";
    await redis.set(key, type, "EX", definite ? TTL_DEFINITE : TTL_OTHER);
  } catch {
    /* ignore cache write failures */
  }

  return type;
}
