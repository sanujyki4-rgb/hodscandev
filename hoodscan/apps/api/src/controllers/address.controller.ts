import type { Request, Response } from "express";
import { prisma } from "@hoodscan/database";
import { serializeBigInt } from "../utils/serialize";
import { parsePagination } from "../utils/pagination";
import { EXPLORER_LIST_CAP } from "@hoodscan/config";
import { attachMethod } from "../utils/methodResolver";
import { getAddressLabel } from "@hoodscan/types";
import { resolveContractInfo } from "../utils/contractNames";
import { isValidAddress } from "../utils/address";

/**
 * GET /address/:address/transactions?limit=20&offset=0
 * Transactions where the address appears as sender OR receiver,
 * newest first.
 */
export async function listTransactionsByAddress(req: Request, res: Response) {
  if (!isValidAddress(req.params.address)) {
    return res.status(400).json({ error: "Invalid address format" });
  }
  const address = req.params.address.toLowerCase();
  const { limit, offset } = parsePagination(req, 20, 100);

  const where = {
    OR: [{ fromAddress: address }, { toAddress: address }],
  };

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: [{ blockNumber: "desc" }, { transactionIndex: "desc" }],
      take: limit,
      skip: offset,
      include: {
        block: { select: { timestamp: true, isFinalized: true } },
      },
    }),
    prisma.transaction.count({ where }),
  ]);

  // Cheap existence check: does this address have ANY NFT (ERC-721/1155)
  // activity? Drives the conditional "NFT Transfers" tab on the web.
  const nftRow = await prisma.nftTransfer.findFirst({
    where: { OR: [{ fromAddress: address }, { toAddress: address }] },
    select: { id: true },
  });
  const hasNftActivity = !!nftRow;

  // Contract flags + verified names for this address and every tx party
  // (shared helper: dedups, resolves + caches names, Etherscan-style).
  const { isContract: isContractByAddr, isToken: isTokenByAddr, names: nameByAddr } = await resolveContractInfo([
    address,
    ...transactions
      .flatMap((tx) => [tx.fromAddress, tx.toAddress])
      .filter((a): a is string => !!a),
  ], false);

  // Method labels via the same shared resolver list endpoints use
  // (allowRemote=false, so this stays fast — curated map + cache only).
  const withMethods = await Promise.all(transactions.map(attachMethod));

  res.json(
    serializeBigInt({
      address,
      label: getAddressLabel(address),
      isContract: isContractByAddr.get(address) ?? null,
      isToken: isTokenByAddr.get(address) ?? false,
      hasNftActivity,
      total: Math.min(total, EXPLORER_LIST_CAP),
      limit,
      offset,
      transactions: withMethods.map((tx) => ({
        ...tx,
        fromLabel: getAddressLabel(tx.fromAddress) ?? nameByAddr.get(tx.fromAddress) ?? null,
        toLabel: tx.toAddress
          ? (getAddressLabel(tx.toAddress) ?? nameByAddr.get(tx.toAddress) ?? null)
          : null,
        fromIsContract: isContractByAddr.get(tx.fromAddress) ?? null,
        fromIsToken: isTokenByAddr.get(tx.fromAddress) ?? false,
        toIsToken: tx.toAddress ? (isTokenByAddr.get(tx.toAddress) ?? false) : false,
        toIsContract: tx.toAddress ? (isContractByAddr.get(tx.toAddress) ?? null) : null,
      })),
    })
  );
}
