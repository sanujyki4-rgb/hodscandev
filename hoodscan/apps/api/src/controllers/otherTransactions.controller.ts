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
 * Transaction types considered "standard" (normal value/contract calls). Every
 * OTHER type — L1↔L2 messages ("0x69"), ArbOS system txs ("0x6a"), and any
 * future Arbitrum-native type — is what the address page's "Other Transactions"
 * tab surfaces, mirroring how explorers separate bridge/system activity from
 * ordinary transactions.
 */
const STANDARD_TX_TYPES = ["0x0", "0x1", "0x2"];

/**
 * GET /address/:address/other-transactions?limit=25&offset=0
 *
 * Non-standard transactions where the address is sender OR receiver, newest
 * first — i.e. L1↔L2 retryable-ticket messages and ArbOS system transactions
 * (txType not in 0x0/0x1/0x2). Same row shape as the Transactions tab so the
 * web can reuse AddressTxTable.
 */
export async function listOtherTransactionsByAddress(
  req: Request,
  res: Response
) {
  if (!isValidAddress(req.params.address)) {
    return res.status(400).json({ error: "Invalid address format" });
  }
  const address = req.params.address.toLowerCase();
  const { limit, offset } = parsePagination(req, 25, 100);

  const where = {
    AND: [
      { OR: [{ fromAddress: address }, { toAddress: address }] },
      { txType: { notIn: STANDARD_TX_TYPES } },
    ],
  };

  const cap = EXPLORER_LIST_CAP;

  const [transactions, cappedRows] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: [{ blockNumber: "desc" }, { transactionIndex: "desc" }],
      take: limit,
      skip: offset,
      include: {
        block: { select: { timestamp: true, isFinalized: true } },
      },
    }),
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count FROM (
        SELECT 1 FROM "Transaction"
        WHERE ("fromAddress" = ${address} OR "toAddress" = ${address})
          AND "txType" NOT IN ('0x0', '0x1', '0x2')
        LIMIT ${cap + 1}
      ) t
    `,
  ]);
  const total = Number(cappedRows[0]?.count ?? 0);

  const { isContract: isContractByAddr, isToken: isTokenByAddr, names: nameByAddr } =
    await resolveContractInfo([
      address,
      ...transactions
        .flatMap((tx) => [tx.fromAddress, tx.toAddress])
        .filter((a): a is string => !!a),
    ]);

  const withMethods = await Promise.all(transactions.map(attachMethod));

  res.json(
    serializeBigInt({
      address,
      label: getAddressLabel(address),
      total: Math.min(total, EXPLORER_LIST_CAP),
      limit,
      offset,
      transactions: withMethods.map((tx) => ({
        ...tx,
        fromLabel:
          getAddressLabel(tx.fromAddress) ?? nameByAddr.get(tx.fromAddress) ?? null,
        toLabel: tx.toAddress
          ? getAddressLabel(tx.toAddress) ?? nameByAddr.get(tx.toAddress) ?? null
          : null,
        fromIsContract: isContractByAddr.get(tx.fromAddress) ?? null,
        fromIsToken: isTokenByAddr.get(tx.fromAddress) ?? false,
        toIsToken: tx.toAddress ? (isTokenByAddr.get(tx.toAddress) ?? false) : false,
        toIsContract: tx.toAddress
          ? isContractByAddr.get(tx.toAddress) ?? null
          : null,
      })),
    })
  );
}
