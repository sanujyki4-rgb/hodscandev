import type { Request, Response } from "express";
import { prisma } from "@hoodscan/database";
import { serializeBigInt } from "../utils/serialize";
import { parsePagination } from "../utils/pagination";
import { EXPLORER_LIST_CAP } from "@hoodscan/config";
import { getAddressLabel } from "@hoodscan/types";
import { formatTokenAmount, decimalToBigInt } from "../utils/formatToken";
import { resolveContractInfo } from "../utils/contractNames";
import { isValidAddress } from "../utils/address";

/**
 * GET /address/:address/internal?limit=25&offset=0
 *
 * Internal transactions (trace sub-calls / value transfers) where the address
 * is the sender OR recipient, newest first, read from the InternalTransaction
 * table populated by the indexer (block-level tracing during backfill + live
 * poll).
 *
 * Unlike the per-tx endpoint (GET /transactions/:hash/internal) this NEVER
 * traces on demand — it only serves what the indexer has already persisted, so
 * a block that hasn't been traced yet simply won't appear here until the
 * internal-tx backfill reaches it. Each row's value is scaled to ETH (18
 * decimals) and tagged IN/OUT relative to the queried address.
 */
export async function listAddressInternalTransactions(
  req: Request,
  res: Response
) {
  if (!isValidAddress(req.params.address)) {
    return res.status(400).json({ error: "Invalid address format" });
  }
  const address = req.params.address.toLowerCase();
  const { limit, offset } = parsePagination(req, 25, 100);

  const where = {
    OR: [{ fromAddress: address }, { toAddress: address }],
  };

  const [internal, total] = await Promise.all([
    prisma.internalTransaction.findMany({
      where,
      orderBy: [{ blockNumber: "desc" }, { traceAddress: "asc" }],
      take: limit,
      skip: offset,
    }),
    prisma.internalTransaction.count({ where }),
  ]);

  // Contract icons + verified names for the From/To parties (shared helper).
  const { isContract: isContractByAddr, isToken: isTokenByAddr, names: nameByAddr } =
    await resolveContractInfo(
      internal.flatMap((r) => [r.fromAddress, r.toAddress]).filter(Boolean) as string[], false
    );

  const rows = internal.map((r) => {
    const raw = decimalToBigInt(r.value);
    return {
      txHash: r.txHash,
      blockNumber: r.blockNumber,
      timestamp: r.timestamp,
      traceAddress: r.traceAddress,
      callType: r.callType,
      fromAddress: r.fromAddress,
      toAddress: r.toAddress,
      rawValue: raw.toString(),
      value: formatTokenAmount(raw, 18),
      gas: r.gas,
      gasUsed: r.gasUsed,
      error: r.error,
      direction:
        r.fromAddress === address
          ? "out"
          : r.toAddress === address
            ? "in"
            : null,
      fromLabel:
        getAddressLabel(r.fromAddress) ?? nameByAddr.get(r.fromAddress) ?? null,
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
      address,
      label: getAddressLabel(address),
      total: Math.min(total, EXPLORER_LIST_CAP),
      limit,
      offset,
      internalTransactions: rows,
    })
  );
}
