import type { Request, Response } from "express";
import { prisma } from "@hoodscan/database";
import { sendRpc } from "@hoodscan/rpc";
import { serializeBigInt } from "../utils/serialize";
import { parsePagination } from "../utils/pagination";
import { EXPLORER_LIST_CAP } from "@hoodscan/config";
import { getAddressLabel } from "@hoodscan/types";
import { formatTokenAmount, decimalToBigInt } from "../utils/formatToken";
import { resolveContractInfo } from "../utils/contractNames";

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * A single node of a geth `callTracer` result. Nested sub-calls live in
 * `calls`. All numeric fields are hex quantities (or absent).
 */
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

/** A flattened InternalTransaction row ready for a createMany insert. */
type InternalTxRow = {
  txHash: string;
  blockNumber: bigint;
  timestamp: Date;
  traceAddress: string;
  callType: string;
  fromAddress: string;
  toAddress: string | null;
  value: string; // wei, decimal string
  gas: bigint | null;
  gasUsed: bigint | null;
  input: string | null;
  output: string | null;
  error: string | null;
};

/** Parse a hex quantity ("0x1a") to bigint, or null when absent/invalid. */
function hexToBigIntOrNull(hex: string | undefined): bigint | null {
  if (!hex) return null;
  try {
    return BigInt(hex);
  } catch {
    return null;
  }
}

/** Parse a hex wei value to a decimal string, defaulting to "0". */
function hexToWeiString(hex: string | undefined): string {
  if (!hex) return "0";
  try {
    return BigInt(hex).toString();
  } catch {
    return "0";
  }
}

/**
 * Depth-first flatten of a callTracer tree into InternalTransaction rows.
 * The ROOT frame is the normal transaction (already stored in Transaction),
 * so it is skipped — only nested sub-calls are emitted. traceAddress encodes
 * the call-tree path as "0", "0_0", "0_1", … Robust: never throws on a
 * malformed frame, just skips it.
 */
function flattenCallTracer(
  root: CallFrame,
  ctx: { txHash: string; blockNumber: bigint; timestamp: Date }
): InternalTxRow[] {
  const rows: InternalTxRow[] = [];

  const walk = (frame: CallFrame, path: number[]) => {
    const children = Array.isArray(frame.calls) ? frame.calls : [];
    children.forEach((child, i) => {
      const childPath = [...path, i];
      const traceAddress = childPath.join("_");
      rows.push({
        txHash: ctx.txHash,
        blockNumber: ctx.blockNumber,
        timestamp: ctx.timestamp,
        traceAddress,
        callType: (child.type ?? "call").toLowerCase(),
        fromAddress: (child.from ?? "").toLowerCase(),
        toAddress: child.to ? child.to.toLowerCase() : null,
        value: hexToWeiString(child.value),
        gas: hexToBigIntOrNull(child.gas),
        gasUsed: hexToBigIntOrNull(child.gasUsed),
        input: child.input ?? null,
        output: child.output ?? null,
        error: child.error ?? null,
      });
      walk(child, childPath);
    });
  };

  walk(root, [0]);
  return rows;
}

/**
 * GET /transactions/:hash/internal?limit=25&offset=0
 *
 * Internal transactions (value transfers & sub-calls produced while a tx
 * executed), decoded from a debug_trace callTracer result. Persisted in the
 * InternalTransaction table by whoever traces first. If none are stored yet,
 * this endpoint lazily fetches the trace ON DEMAND (trace role: Uniblock →
 * QuickNode, never ZAN), decodes + persists it, then serves the rows —
 * matching the project's "traces are on-demand, never bulk" strategy.
 */
export async function listInternalTransactions(req: Request, res: Response) {
  const { hash } = req.params;
  if (!HASH_RE.test(hash)) {
    return res.status(400).json({ error: "Invalid transaction hash format" });
  }
  const txHash = hash.toLowerCase();
  const { limit, offset } = parsePagination(req, 25, 100);

  // The tx must exist before we spend a trace call on it.
  const tx = await prisma.transaction.findUnique({
    where: { hash: txHash },
    select: {
      blockNumber: true,
      block: { select: { timestamp: true } },
    },
  });
  if (!tx) {
    return res.status(404).json({ error: "Transaction not found" });
  }

  let traceError: string | null = null;
  let total = await prisma.internalTransaction.count({ where: { txHash } });

  // Lazily trace + persist only when nothing is stored yet.
  if (total === 0) {
    try {
      const trace = (await sendRpc(
        "debug_traceTransaction",
        [txHash, { tracer: "callTracer" }],
        { roleHint: "trace" }
      )) as CallFrame | null;

      if (trace) {
        const rows = flattenCallTracer(trace, {
          txHash,
          blockNumber: tx.blockNumber,
          timestamp: tx.block?.timestamp ?? new Date(),
        });
        if (rows.length > 0) {
          // Idempotent on the (txHash, traceAddress) unique constraint.
          await prisma.internalTransaction.createMany({
            data: rows,
            skipDuplicates: true,
          });
        }
        total = await prisma.internalTransaction.count({ where: { txHash } });
      }
    } catch (err) {
      // A tracing failure must never 500 the page — surface a note instead.
      traceError =
        err instanceof Error ? err.message : "Failed to fetch transaction trace";
    }
  }

  const internal = await prisma.internalTransaction.findMany({
    where: { txHash },
    orderBy: { traceAddress: "asc" },
    take: limit,
    skip: offset,
  });

  const partyAddresses = [
    ...new Set(
      internal.flatMap((r) => [r.fromAddress, r.toAddress]).filter(Boolean) as string[]
    ),
  ];
  const { isContract: isContractByAddr, isToken: isTokenByAddr, names: nameByAddr } =
    await resolveContractInfo(partyAddresses, false);

  const rows = internal.map((r) => {
    const raw = decimalToBigInt(r.value);
    return {
      traceAddress: r.traceAddress,
      callType: r.callType,
      fromAddress: r.fromAddress,
      toAddress: r.toAddress,
      rawValue: raw.toString(),
      value: formatTokenAmount(raw, 18),
      gas: r.gas,
      gasUsed: r.gasUsed,
      input: r.input,
      output: r.output,
      error: r.error,
      fromLabel: getAddressLabel(r.fromAddress) ?? nameByAddr.get(r.fromAddress) ?? null,
      toLabel: r.toAddress
        ? getAddressLabel(r.toAddress) ?? nameByAddr.get(r.toAddress) ?? null
        : null,
      fromIsContract: isContractByAddr.get(r.fromAddress) ?? null,
      fromIsToken: isTokenByAddr.get(r.fromAddress) ?? false,
      toIsToken: r.toAddress ? (isTokenByAddr.get(r.toAddress) ?? false) : false,
      toIsContract: r.toAddress ? isContractByAddr.get(r.toAddress) ?? null : null,
    };
  });

  res.json(
    serializeBigInt({
      txHash,
      total: Math.min(total, EXPLORER_LIST_CAP),
      limit,
      offset,
      traceError,
      internalTransactions: rows,
    })
  );
}
