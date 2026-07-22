import { prisma } from "@hoodscan/database";

/**
 * Layer 3 — persist "internal transactions" (the value transfers & sub-calls a
 * tx makes during execution), decoded from a geth `callTracer` result.
 *
 * Traces are ON-DEMAND ONLY (see rpc/traceOnDemand.ts): ZAN cannot serve
 * debug_trace* and tracing all ~14M blocks would blow every quota. So these
 * rows are written LAZILY — only when a transaction's trace is actually
 * requested — and are idempotent on the (txHash, traceAddress) unique
 * constraint, so re-requesting the same trace never duplicates rows.
 */

/** One decoded internal call, mirroring the InternalTransaction table. */
export type InternalTransactionRow = {
  txHash: string;
  blockNumber: bigint;
  timestamp: Date;
  traceAddress: string; // call-tree path, e.g. "0", "0_1", "0_1_2"
  callType: string; // call | delegatecall | staticcall | create | create2 | selfdestruct
  fromAddress: string;
  toAddress: string | null; // null for contract creation
  value: string; // wei, decimal string (default "0")
  gas: bigint | null;
  gasUsed: bigint | null;
  input: string | null;
  output: string | null;
  error: string | null;
};

/** Shape of a geth callTracer node (best-effort — every field is optional). */
type CallFrame = {
  type?: string;
  from?: string;
  to?: string;
  value?: string;
  gas?: string;
  gasUsed?: string;
  input?: string;
  output?: string;
  error?: string;
  calls?: CallFrame[];
};

/** Parse a hex quantity ("0x1a") → bigint, or null if absent/invalid. */
function hexToBigIntOrNull(hex: unknown): bigint | null {
  if (typeof hex !== "string" || hex.length === 0) return null;
  try {
    return BigInt(hex);
  } catch {
    return null;
  }
}

/** Parse a hex wei value → decimal string, defaulting to "0". */
function hexToDecimalString(hex: unknown): string {
  if (typeof hex !== "string" || hex.length === 0) return "0";
  try {
    return BigInt(hex).toString();
  } catch {
    return "0";
  }
}

/** Non-empty trimmed string, or null. */
function strOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.length > 0 ? value : null;
}

/**
 * Flatten a geth `callTracer` result into InternalTransactionRow[].
 *
 * The tracer returns a tree: the ROOT frame is the top-level transaction (which
 * is already stored in the Transaction table), and its `calls[]` are the nested
 * internal calls. We walk depth-first, building traceAddress path strings
 * ("0", "0_0", "0_1", …), and SKIP the root — emitting only nested calls, which
 * is what an explorer's "Internal Txns" tab shows.
 *
 * Robust to missing fields; never throws.
 *
 * @param trace the object from debug_traceTransaction with {tracer:"callTracer"}
 * @param opts  parent tx context stamped onto every row
 */
export function decodeCallTracer(
  trace: unknown,
  opts: { txHash: string; blockNumber: bigint; timestamp: Date }
): InternalTransactionRow[] {
  const rows: InternalTransactionRow[] = [];
  if (!trace || typeof trace !== "object") return rows;

  const root = trace as CallFrame;

  const walk = (frame: CallFrame, path: string, isRoot: boolean): void => {
    if (!frame || typeof frame !== "object") return;

    // Emit every node EXCEPT the root (the root is the normal tx already
    // persisted in Transaction; path "" identifies it).
    if (!isRoot) {
      rows.push({
        txHash: opts.txHash,
        blockNumber: opts.blockNumber,
        timestamp: opts.timestamp,
        traceAddress: path,
        callType: (frame.type ?? "call").toLowerCase(),
        fromAddress: (frame.from ?? "").toLowerCase(),
        toAddress: frame.to ? frame.to.toLowerCase() : null,
        value: hexToDecimalString(frame.value),
        gas: hexToBigIntOrNull(frame.gas),
        gasUsed: hexToBigIntOrNull(frame.gasUsed),
        input: strOrNull(frame.input),
        output: strOrNull(frame.output),
        error: strOrNull(frame.error),
      });
    }

    const children = Array.isArray(frame.calls) ? frame.calls : [];
    children.forEach((child, i) => {
      const childPath = isRoot ? `${i}` : `${path}_${i}`;
      walk(child, childPath, false);
    });
  };

  walk(root, "", true);
  return rows;
}

/**
 * Bulk-insert internal-transaction rows. skipDuplicates + the (txHash,
 * traceAddress) unique constraint make this idempotent — re-persisting the same
 * trace never double-inserts. Empty input is a no-op.
 *
 * @returns { count } number of rows actually inserted
 */
export async function saveInternalTransactions(
  rows: InternalTransactionRow[]
): Promise<{ count: number }> {
  if (rows.length === 0) return { count: 0 };
  const result = await prisma.internalTransaction.createMany({
    data: rows,
    skipDuplicates: true,
  });
  return { count: result.count };
}
