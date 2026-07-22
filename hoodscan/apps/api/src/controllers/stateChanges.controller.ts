import type { Request, Response } from "express";
import { prisma } from "@hoodscan/database";
import { sendRpc } from "@hoodscan/rpc";
import { serializeBigInt } from "../utils/serialize";

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * One account's state as reported by the prestateTracer (diffMode:true).
 * All fields are optional/absent-friendly: `post` omits fields that did
 * not change, and `storage` is a sparse map of only-changed slots. Never
 * assume a field is present.
 */
type PrestateAccount = {
  balance?: string; // hex wei quantity, e.g. "0x7a48429e177130a"
  nonce?: number; // uint64 (unquoted JSON number)
  code?: string; // hex bytecode
  storage?: Record<string, string>; // slot(hex) -> value(hex), sparse
};

/**
 * prestateTracer diffMode:true result. `pre` is the beginning-of-tx state,
 * `post` the end-of-tx state. Only accounts touched by the tx appear, and
 * within them only changed storage slots. Robust decoding must tolerate a
 * null/undefined result and any missing sub-field.
 */
type PrestateDiff = {
  pre?: Record<string, PrestateAccount>;
  post?: Record<string, PrestateAccount>;
};

/** One decoded storage slot change (before/after are 0x hex values). */
type StorageChange = {
  slot: string;
  before: string;
  after: string;
};

/** One decoded per-address state change. */
type StateChange = {
  address: string;
  balanceBefore: string; // wei decimal string, default "0"
  balanceAfter: string; // wei decimal string, default "0"
  nonceBefore: number;
  nonceAfter: number;
  storageChanges: StorageChange[];
};

/** Parse a hex wei quantity to a decimal string, defaulting to "0". */
function hexToWeiString(hex: string | undefined): string {
  if (!hex) return "0";
  try {
    return BigInt(hex).toString();
  } catch {
    return "0";
  }
}

/** Coerce a possibly-missing/malformed nonce to a plain number, default 0. */
function toNonce(nonce: number | undefined): number {
  if (typeof nonce === "number" && Number.isFinite(nonce)) return nonce;
  return 0;
}

/** Zero-value storage slot used when a slot exists only in pre OR post. */
const ZERO_SLOT = "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Decode a prestateTracer diffMode result into per-address changes. Only
 * addresses/slots that actually changed are emitted. Never throws on
 * malformed data — unknown/absent fields fall back to sane defaults.
 */
function decodeStateDiff(diff: PrestateDiff | null | undefined): StateChange[] {
  if (!diff || typeof diff !== "object") return [];
  const pre = diff.pre && typeof diff.pre === "object" ? diff.pre : {};
  const post = diff.post && typeof diff.post === "object" ? diff.post : {};

  const addresses = new Set<string>([
    ...Object.keys(pre),
    ...Object.keys(post),
  ]);

  const changes: StateChange[] = [];

  for (const rawAddr of addresses) {
    const address = rawAddr.toLowerCase();
    const preAcc: PrestateAccount = pre[rawAddr] ?? {};
    const postAcc: PrestateAccount = post[rawAddr] ?? {};

    // In diffMode, `post` only reports fields that changed. When a field is
    // absent from post, it is unchanged — so fall back to the pre value.
    const balanceBefore = hexToWeiString(preAcc.balance);
    const balanceAfter =
      postAcc.balance !== undefined
        ? hexToWeiString(postAcc.balance)
        : balanceBefore;

    const nonceBefore = toNonce(preAcc.nonce);
    const nonceAfter =
      postAcc.nonce !== undefined ? toNonce(postAcc.nonce) : nonceBefore;

    // Storage: union of pre + post slots; each side is sparse (only-changed).
    const preStorage =
      preAcc.storage && typeof preAcc.storage === "object" ? preAcc.storage : {};
    const postStorage =
      postAcc.storage && typeof postAcc.storage === "object"
        ? postAcc.storage
        : {};
    const slots = new Set<string>([
      ...Object.keys(preStorage),
      ...Object.keys(postStorage),
    ]);

    const storageChanges: StorageChange[] = [];
    for (const slot of slots) {
      const before = preStorage[slot] ?? ZERO_SLOT;
      const after = postStorage[slot] ?? ZERO_SLOT;
      if (before === after) continue; // no real change
      storageChanges.push({ slot, before, after });
    }

    // Skip addresses with no actual change at all.
    const balanceChanged = balanceBefore !== balanceAfter;
    const nonceChanged = nonceBefore !== nonceAfter;
    if (!balanceChanged && !nonceChanged && storageChanges.length === 0) {
      continue;
    }

    changes.push({
      address,
      balanceBefore,
      balanceAfter,
      nonceBefore,
      nonceAfter,
      storageChanges,
    });
  }

  // Stable ordering: by address, so the UI is deterministic.
  changes.sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
  return changes;
}

/**
 * GET /transactions/:hash/state-diff
 *
 * State changes ("Advanced TxInfo") for a transaction: the per-account
 * balance/nonce/storage deltas produced while the tx executed, decoded from a
 * debug_traceTransaction prestateTracer (diffMode:true) result fetched ON
 * DEMAND — mirroring the internal-transactions on-demand flow. The trace is
 * routed to the trace-capable provider (trace role: Uniblock → QuickNode,
 * never ZAN) via `sendRpc(..., { roleHint: "trace" })`.
 *
 * Returns `{ txHash, stateChanges: [...] }`. If the provider cannot trace,
 * returns a graceful 200 with `{ txHash, stateChanges: [], unavailable: true }`
 * (same "trace unavailable" philosophy as the internal-tx endpoint) so the tx
 * page never 500s over a missing trace.
 */
export async function getTransactionStateDiff(req: Request, res: Response) {
  const { hash } = req.params;
  if (!HASH_RE.test(hash)) {
    return res.status(400).json({ error: "Invalid transaction hash format" });
  }
  const txHash = hash.toLowerCase();

  // The tx must exist before we spend a trace call on it.
  const tx = await prisma.transaction.findUnique({
    where: { hash: txHash },
    select: { hash: true },
  });
  if (!tx) {
    return res.status(404).json({ error: "Transaction not found" });
  }

  try {
    const diff = (await sendRpc(
      "debug_traceTransaction",
      [
        txHash,
        { tracer: "prestateTracer", tracerConfig: { diffMode: true } },
      ],
      { roleHint: "trace" }
    )) as PrestateDiff | null;

    const stateChanges = decodeStateDiff(diff);
    return res.json(serializeBigInt({ txHash, stateChanges }));
  } catch {
    // A tracing failure must never 500 the page — surface a graceful,
    // honest "unavailable" flag instead (mirrors the internal-tx endpoint).
    return res.json({ txHash, stateChanges: [], unavailable: true });
  }
}
