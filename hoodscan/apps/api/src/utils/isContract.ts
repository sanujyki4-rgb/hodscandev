/**
 * On-chain "is this address a contract?" detection via eth_getCode.
 *
 * This is what lets the UI show the little contract icon next to an
 * address (Etherscan/Arbiscan style) — an address with deployed bytecode
 * is a contract; an empty-code address is a regular wallet (EOA).
 *
 * Self-reliant: talks ONLY to the user's own Robinhood Chain RPC node
 * (no external APIs). Mirrors the viem client + Redis caching pattern of
 * apps/api/src/utils/contractType.ts.
 */
import { redis } from "../middlewares/cache";
import { rpcClient } from "./rpcClient";

const CACHE_PREFIX = "hoodscan:iscontract:";
const TTL_CONTRACT = 60 * 60 * 24 * 30; // 30 days — code is effectively permanent
const TTL_EOA = 60 * 60 * 24; // 1 day — an EOA could later become a contract (CREATE2)

/**
 * EIP-7702 delegation designator prefix. A "7702" wallet is an EOA that
 * has temporarily pointed at contract code (code = 0xef0100 ‖ 20-byte
 * address). It is still fundamentally a wallet, NOT a contract, so we
 * must not flag it with the contract icon.
 */
const EIP7702_PREFIX = "0xef0100";

/**
 * Return whether an address is a smart contract.
 *
 * - Normalizes the address to lowercase; returns null for empty/nullish.
 * - Reads a Redis cache first (hoodscan:iscontract:<address>): "1" =
 *   contract, "0" = wallet.
 * - When `allowRemote` is false and there's no cache hit, returns null
 *   WITHOUT any on-chain call — keeps list endpoints fast; the icon
 *   simply appears once the address has been resolved (e.g. by a detail
 *   view) and cached.
 * - When `allowRemote` is true, does a live eth_getCode and caches it.
 *
 * Always best-effort: never throws. Returns null on an RPC failure
 * (unknown) rather than guessing.
 */
export async function isContractAddress(
  address: string | null | undefined,
  allowRemote = false
): Promise<boolean | null> {
  const addr = (address ?? "").trim().toLowerCase();
  if (!addr) return null;

  const key = CACHE_PREFIX + addr;

  // 1. Cache read (best-effort).
  try {
    const cached = await redis.get(key);
    if (cached === "1") return true;
    if (cached === "0") return false;
  } catch {
    /* cache is best-effort */
  }

  // 2. Cache miss. Don't block list endpoints with on-chain calls.
  if (!allowRemote) return null;

  // 3. Live eth_getCode against the user's own RPC node.
  let result: boolean;
  try {
    const code = (await rpcClient.request({
      method: "eth_getCode",
      params: [addr as `0x${string}`, "latest"],
    })) as string;
    const normalized = (code ?? "").toLowerCase();
    result =
      normalized.length > 0 &&
      normalized !== "0x" &&
      !normalized.startsWith(EIP7702_PREFIX);
  } catch {
    // Unknown — don't cache a guess on transient RPC failure.
    return null;
  }

  // 4. Cache the result. Contracts live long; EOAs are re-checked sooner.
  try {
    await redis.set(key, result ? "1" : "0", "EX", result ? TTL_CONTRACT : TTL_EOA);
  } catch {
    /* ignore cache write failures */
  }

  return result;
}

/**
 * Fetch an address's raw runtime bytecode via eth_getCode. Returns the
 * hex string ("0x" when there is no code / on failure). Used by the
 * address page "Contract" tab. Best-effort: never throws.
 */
export async function getContractBytecode(
  address: string | null | undefined
): Promise<string> {
  const addr = (address ?? "").trim().toLowerCase();
  if (!addr) return "0x";
  try {
    const code = (await rpcClient.request({
      method: "eth_getCode",
      params: [addr as `0x${string}`, "latest"],
    })) as string;
    return code ?? "0x";
  } catch {
    return "0x";
  }
}
