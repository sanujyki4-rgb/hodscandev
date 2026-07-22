/**
 * Decodes an event log into a named, typed parameter list — the way
 * Etherscan/Arbiscan show a fully "decoded" log, not just an event name.
 *
 * Strategy (all best-effort, never throws):
 *   1. Prefer the emitting contract's VERIFIED ABI (proxy-resolved) so we get
 *      the exact parameter names/types the author declared.
 *   2. Fall back to the OpenChain signature database (event lookup) to turn the
 *      topic0 hash into candidate event signatures, then ABI-decode against
 *      each candidate with viem.
 *
 * OpenChain event-signature lookups are cached in Redis
 * (hoodscan:sigevent:<topic0>), mirroring the calldata decoder in
 * inputDecoder.ts.
 */
import { redis } from "../middlewares/cache";
import { decodeEventLog, parseAbiItem } from "viem";
import { resolveContract } from "./verifiedAbi";

const OPENCHAIN_URL = "https://api.openchain.xyz/signature-database/v1/lookup";
const CACHE_PREFIX = "hoodscan:sigevent:";
const TTL_FOUND = 60 * 60 * 24 * 30; // 30 days
const TTL_EMPTY = 60 * 60 * 24; // 1 day — re-check empties occasionally

export interface DecodedEventParam {
  name: string;
  type: string;
  indexed: boolean;
  value: string;
}

export type DecodedEvent = {
  name: string;
  signature: string;
  params: DecodedEventParam[];
} | null;

/**
 * Candidate text signatures for an event topic0, via the OpenChain event
 * signature DB. Results (including empties) are cached in Redis. Always returns
 * an array; [] on any error/miss.
 */
export async function lookupEventSignatureText(topic0: string): Promise<string[]> {
  const sig = (topic0 ?? "").trim().toLowerCase();
  if (!sig) return [];

  const key = CACHE_PREFIX + sig;

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
    const res = await fetch(`${OPENCHAIN_URL}?event=${sig}&filter=true`, {
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) {
      const data: any = await res.json();
      const arr = data?.result?.event?.[sig];
      if (Array.isArray(arr)) {
        names = arr
          .map((entry: any) => entry?.name)
          .filter(
            (name: any): name is string =>
              typeof name === "string" && name.length > 0
          );
      }
    }
  } catch {
    /* network is best-effort */
  }

  try {
    await redis.set(
      key,
      JSON.stringify(names),
      "EX",
      names.length > 0 ? TTL_FOUND : TTL_EMPTY
    );
  } catch {
    /* ignore */
  }

  return names;
}

/** Stringify a decoded value without ever throwing (BigInt-safe). */
function stringifyArg(v: unknown): string {
  try {
    if (typeof v === "bigint") return v.toString();
    if (v !== null && typeof v === "object") {
      return JSON.stringify(v, (_k, val) =>
        typeof val === "bigint" ? val.toString() : val
      );
    }
    return String(v);
  } catch {
    return "";
  }
}

type AbiEventInput = { name?: string; type: string; indexed?: boolean };

/** Map a viem-decoded event (args + the matching ABI event) into params. */
function buildParams(
  inputs: AbiEventInput[],
  args: Record<string, unknown> | readonly unknown[] | undefined
): DecodedEventParam[] {
  return inputs.map((inp, i) => {
    let value: unknown;
    if (Array.isArray(args)) {
      value = args[i];
    } else if (args && typeof args === "object") {
      const named = inp.name ? (args as Record<string, unknown>)[inp.name] : undefined;
      value = named !== undefined ? named : (args as Record<string, unknown>)[i];
    }
    return {
      name: inp.name || `arg${i}`,
      type: inp.type,
      indexed: Boolean(inp.indexed),
      value: stringifyArg(value),
    };
  });
}

/**
 * Decode a single event log into { name, signature, params } or null. Tries the
 * verified ABI first, then the OpenChain event signature DB. Never throws.
 */
export async function decodeEventLog2(log: {
  address: string;
  topic0: string | null;
  topic1: string | null;
  topic2: string | null;
  topic3: string | null;
  data: string;
}): Promise<DecodedEvent> {
  if (!log.topic0) return null;

  const topics = [log.topic0, log.topic1, log.topic2, log.topic3].filter(
    (t): t is string => !!t
  ) as [`0x${string}`, ...`0x${string}`[]];
  const data = (log.data && log.data.length > 0 ? log.data : "0x") as `0x${string}`;

  // 1. Verified ABI of the emitting contract (proxy-resolved).
  try {
    const resolved = await resolveContract(log.address);
    if (resolved && resolved.effectiveAbi.length > 0) {
      const abi = resolved.effectiveAbi as any[];
      const decoded = decodeEventLog({ abi, topics, data }) as any;
      const eventName = decoded.eventName as string;
      const match = abi.find(
        (item) => item?.type === "event" && item?.name === eventName
      );
      const inputs: AbiEventInput[] = (match?.inputs ?? []) as AbiEventInput[];
      const params = buildParams(inputs, decoded.args as any);
      const sigTypes = inputs
        .map((inp) => `${inp.type}${inp.indexed ? " indexed" : ""} ${inp.name ?? ""}`.trim())
        .join(", ");
      return {
        name: eventName,
        signature: `${eventName}(${sigTypes})`,
        params,
      };
    }
  } catch {
    /* fall through to signature DB */
  }

  // 2. OpenChain event signature DB fallback.
  try {
    const candidates = await lookupEventSignatureText(log.topic0);
    for (const candidate of candidates) {
      try {
        const item = parseAbiItem(`event ${candidate}`) as any;
        const decoded = decodeEventLog({ abi: [item], topics, data }) as any;
        const inputs: AbiEventInput[] = (item.inputs ?? []) as AbiEventInput[];
        const params = buildParams(inputs, decoded.args as any);
        const name =
          (decoded.eventName as string) || candidate.split("(")[0];
        return { name, signature: candidate, params };
      } catch {
        /* try the next candidate */
      }
    }
  } catch {
    /* ignore */
  }

  return null;
}
