/**
 * Resolves a transaction's function selector into a human-readable
 * Method label (Etherscan/Arbiscan style), with a fallback chain:
 *
 *   1. txType rules (System / L1↔L2) and empty calldata (Transfer)
 *   2. curated METHOD_SIGNATURES map in @hoodscan/types
 *   3. Redis cache (hoodscan:sig:<selector>)
 *   4. live lookup against the OpenChain signature database — ONLY when
 *      allowRemote is true (used by the single-tx detail endpoint), so
 *      list endpoints stay fast. Results (hits AND misses) are cached.
 *   5. raw 4-byte selector (same as getMethodLabel's final fallback)
 *
 * This is what lets the explorer show real method names even for
 * contracts that the public block explorer leaves as raw hex.
 */
import { METHOD_SIGNATURES, getMethodLabel, isSystemTxType, isL1ToL2TxType } from "@hoodscan/types";
import { redis } from "../middlewares/cache";
import { getContractType } from "./contractType";

const OPENCHAIN_URL = "https://api.openchain.xyz/signature-database/v1/lookup";
const CACHE_PREFIX = "hoodscan:sig:";
const TTL_FOUND = 60 * 60 * 24 * 30; // 30 days
const TTL_MISS = 60 * 60 * 24; // 1 day — re-check misses occasionally

/**
 * Turn a raw text signature like
 * "swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,...)"
 * into a short friendly label ("Swap"). Falls back to Title-casing the
 * function name for anything without a well-known verb.
 */
export function humanizeSignature(textSignature: string): string {
  const name = (textSignature.split("(")[0] ?? "").trim();
  if (!name) return "";
  const lower = name.toLowerCase();
  if (lower.includes("swap") || lower.includes("trade")) return "Swap";
  if (lower.includes("multicall")) return "Multicall";
  if (lower.startsWith("deposit")) return "Deposit";
  if (lower.startsWith("withdraw")) return "Withdraw";

  const words = name
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1)));
  // Keep labels compact.
  return words.length > 3 ? words.slice(0, 3).join(" ") : words.join(" ");
}

async function lookupOpenChain(selector: string): Promise<string | null> {
  try {
    const res = await fetch(`${OPENCHAIN_URL}?function=${selector}&filter=true`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const arr = data?.result?.function?.[selector];
    if (Array.isArray(arr) && arr.length > 0 && arr[0]?.name) {
      return humanizeSignature(arr[0].name);
    }
    return null;
  } catch {
    return null;
  }
}

export async function resolveMethod(
  selector: string | null | undefined,
  txType?: string | null,
  allowRemote = false,
  contractAddress?: string | null
): Promise<string> {
  if (isSystemTxType(txType)) return "System";
  if (isL1ToL2TxType(txType)) return "L1↔L2 Message";

  const sel = (selector ?? "").trim().toLowerCase();
  if (!sel || sel === "0x") return "Transfer";

  // transferFrom (0x23b872dd) is ambiguous: ERC-20 and ERC-721 share
  // it. Resolve via on-chain contract type BEFORE the curated map (the
  // curated map would otherwise unconditionally return "Transfer From").
  if (sel === "0x23b872dd") {
    const ctype = await getContractType(contractAddress, allowRemote);
    if (ctype === "erc721" || ctype === "erc1155") return "NFT Transfer";
    if (ctype === "erc20" || ctype === "other") return "Token Transfer";
    // null (unknown, e.g. list-endpoint cache miss): default to Token
    // Transfer — transferFrom is most commonly ERC-20. The detail view
    // (allowRemote=true) resolves and caches the accurate type.
    return "Token Transfer";
  }

  // Curated map wins — instant, no I/O.
  const curated = METHOD_SIGNATURES[sel];
  if (curated) return curated;

  // Redis cache. "" is a stored sentinel meaning "known miss".
  const key = CACHE_PREFIX + sel;
  try {
    const cached = await redis.get(key);
    if (cached !== null && cached !== "") return cached;
    if (cached === "" && !allowRemote) return getMethodLabel(sel, txType);
    if (cached === "" && allowRemote) {
      // Known miss but caller wants a fresh attempt; fall through.
    }
  } catch {
    /* cache is best-effort */
  }

  if (!allowRemote) return getMethodLabel(sel, txType);

  const label = await lookupOpenChain(sel);
  try {
    await redis.set(key, label ?? "", "EX", label ? TTL_FOUND : TTL_MISS);
  } catch {
    /* ignore */
  }

  return label ?? getMethodLabel(sel, txType);
}

/**
 * Attach a `method` label to a transaction row. Used by list endpoints,
 * so allowRemote is false (cache + curated only, no blocking HTTP).
 */
export async function attachMethod<
  T extends {
    functionSelector?: string | null;
    txType?: string | null;
    toAddress?: string | null;
  }
>(tx: T): Promise<T & { method: string }> {
  return {
    ...tx,
    method: await resolveMethod(
      tx.functionSelector ?? null,
      tx.txType ?? null,
      false,
      tx.toAddress ?? null
    ),
  };
}
