/**
 * Decodes a transaction's raw input calldata into named function
 * arguments (name / type / value), the way Etherscan/Arbiscan show a
 * "Decoded Input" panel. Uses the OpenChain signature database to turn
 * a 4-byte selector into candidate text signatures, then viem to
 * actually ABI-decode the calldata against each candidate.
 *
 * Text-signature lookups are cached in Redis (hoodscan:sigtext:<selector>)
 * so we don't hit OpenChain on every detail-page load. Everything here is
 * best-effort: any failure returns null / [] rather than throwing, so the
 * detail endpoint never breaks just because decoding failed.
 */
import { redis } from "../middlewares/cache";
import { parseAbiItem, decodeFunctionData } from "viem";

const OPENCHAIN_URL = "https://api.openchain.xyz/signature-database/v1/lookup";
const CACHE_PREFIX = "hoodscan:sigtext:";
const TTL_FOUND = 60 * 60 * 24 * 30; // 30 days
const TTL_EMPTY = 60 * 60 * 24; // 1 day — re-check empties occasionally

/**
 * Look up the candidate text signatures for a 4-byte selector via the
 * OpenChain signature database. Results (including empties) are cached
 * in Redis. Always returns an array; [] on any error/miss.
 */
export async function lookupSignatureText(selector: string): Promise<string[]> {
  const sel = (selector ?? "").trim().toLowerCase();
  if (!sel) return [];

  const key = CACHE_PREFIX + sel;

  // Read the cache first.
  try {
    const cached = await redis.get(key);
    if (cached !== null) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    /* cache is best-effort */
  }

  let names: string[] = [];
  try {
    const res = await fetch(`${OPENCHAIN_URL}?function=${sel}&filter=true`, {
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) {
      const data: any = await res.json();
      const arr = data?.result?.function?.[sel];
      if (Array.isArray(arr)) {
        names = arr
          .map((entry: any) => entry?.name)
          .filter((name: any): name is string => typeof name === "string" && name.length > 0);
      }
    }
  } catch {
    /* network is best-effort */
  }

  try {
    await redis.set(key, JSON.stringify(names), "EX", names.length > 0 ? TTL_FOUND : TTL_EMPTY);
  } catch {
    /* ignore */
  }

  return names;
}

/**
 * Turn any decoded argument value into a display string, without ever
 * throwing. BigInts and nested BigInts are stringified so JSON.stringify
 * doesn't blow up.
 */
function stringifyArg(v: unknown): string {
  try {
    if (typeof v === "bigint") return v.toString();
    if (v !== null && typeof v === "object") {
      return JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val));
    }
    return String(v);
  } catch {
    return "";
  }
}

/**
 * Decode a transaction's raw input against its 4-byte selector. Returns
 * the matched signature, the function name, and an array of decoded
 * arguments — or null when there's nothing decodable.
 */
export async function decodeInput(
  input: string | null | undefined,
  selector: string | null | undefined
): Promise<
  | { signature: string; name: string; args: { name: string; type: string; value: string }[] }
  | null
> {
  const data = (input ?? "").trim();
  const sel = (selector ?? "").trim();
  if (!data || data === "0x" || data.length < 10 || !sel) return null;

  const candidates = await lookupSignatureText(sel);
  if (candidates.length === 0) return null;

  for (const candidate of candidates) {
    try {
      const item = parseAbiItem("function " + candidate);
      const { args } = decodeFunctionData({ abi: [item as any], data: data as `0x${string}` });
      const inputs = ((item as any).inputs ?? []) as { name?: string; type: string }[];
      const decodedArgs = inputs.map((inp, i) => ({
        name: inp.name || "arg" + i,
        type: inp.type,
        value: stringifyArg((args as any)?.[i]),
      }));
      return { signature: candidate, name: candidate.split("(")[0], args: decodedArgs };
    } catch {
      /* try the next candidate */
    }
  }

  // Had a signature but couldn't decode the calldata against any of them.
  return { signature: candidates[0], name: candidates[0].split("(")[0], args: [] };
}
