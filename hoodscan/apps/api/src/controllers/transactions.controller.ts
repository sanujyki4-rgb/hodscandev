import type { Request, Response } from "express";
import { prisma } from "@hoodscan/database";
import { TX_TYPE_LABELS } from "@hoodscan/types";
import { resolveMethod, attachMethod } from "../utils/methodResolver";
import { withAddressLabels } from "../utils/addressLabel";
import { decodeInput } from "../utils/inputDecoder";
import { resolveTokenTransfer } from "../utils/tokenTransfer";
import { isContractAddress } from "../utils/isContract";
import { serializeBigInt } from "../utils/serialize";
import { parsePagination } from "../utils/pagination";
import { cappedCount } from "../utils/count";


/**
 * GET /transactions?limit=15&offset=0
 * Latest transactions across the whole chain (not scoped to one
 * block), newest first. Always returns the paginated envelope
 * { transactions, total, limit, offset } — the same shape whether or
 * not an offset is passed. Callers that only need the rows (e.g. the
 * homepage panel) read `.transactions`.
 */
export async function listLatestTransactions(req: Request, res: Response) {
  const { limit, offset } = parsePagination(req, 15, 50);

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      orderBy: [{ blockNumber: "desc" }, { transactionIndex: "desc" }],
      take: limit,
      skip: offset,
      include: {
        block: { select: { timestamp: true, isFinalized: true } },
      },
    }),
    cappedCount("Transaction"),
  ]);

  res.json(serializeBigInt({ transactions: (await Promise.all(transactions.map(attachMethod))).map(withAddressLabels), total, limit, offset }));
}

/**
 * GET /transactions/l1-to-l2?limit=15&offset=0
 * Real L1->L2 messages (Bridge contract retryable tickets on Ethereum
 * L1) — mirrors Arbiscan's txsDeposits page. Query starts from
 * `L1ToL2Message`, NOT `Transaction`: a message can exist on L1
 * (status "initiated") before its retryable ticket has landed on L2
 * at all, and those "Pending Confirmation" rows are exactly what
 * Arbiscan's full deposits page shows. Starting from `Transaction`
 * (txType "0x69") like the old version of this endpoint did would
 * silently hide every pending row, since a Transaction row for it
 * doesn't exist yet.
 *
 * Filtering is explicit and decoupled from pagination: pass
 * ?status=relayed (the homepage panel, matching Arbiscan's homepage
 * which reserves pending rows for its dedicated /txsDeposits view) or
 * ?status=initiated to narrow; omit it (or ?status=all) for the full
 * "view all" deposits page, pending rows included.
 *
 * Always returns the paginated envelope { transactions, total, limit,
 * offset } — the same shape regardless of status or offset.
 */
export async function listL1ToL2Transactions(req: Request, res: Response) {
  const { limit, offset } = parsePagination(req, 15, 50);
  const statusParam =
    typeof req.query.status === "string" ? req.query.status : "all";
  const where =
    statusParam === "relayed" || statusParam === "initiated"
      ? { status: statusParam }
      : {};
  const include = {
    transaction: {
      select: {
        hash: true,
        blockNumber: true,
        block: { select: { timestamp: true, isFinalized: true } },
      },
    },
  };

  const toRow = (msg: {
    id: bigint;
    originBlockNumber: bigint;
    originTxHash: string;
    originAddress: string;
    originTimestamp: Date;
    status: string;
    transaction: {
      hash: string;
      blockNumber: bigint;
      block: { timestamp: Date; isFinalized: boolean } | null;
    } | null;
  }) => ({
    id: msg.id,
    originBlockNumber: msg.originBlockNumber,
    originTxHash: msg.originTxHash,
    originAddress: msg.originAddress,
    originTimestamp: msg.originTimestamp,
    status: msg.status,
    l2TxHash: msg.transaction?.hash ?? null,
    l2Block: msg.transaction
      ? {
          number: msg.transaction.blockNumber,
          timestamp: msg.transaction.block?.timestamp ?? null,
          isFinalized: msg.transaction.block?.isFinalized ?? false,
        }
      : null,
  });

  const [messages, total] = await Promise.all([
    prisma.l1ToL2Message.findMany({
      where,
      orderBy: { originBlockNumber: "desc" },
      take: limit,
      skip: offset,
      include,
    }),
    cappedCount("L1ToL2Message"),
  ]);

  res.json(serializeBigInt({ transactions: messages.map(toRow), total, limit, offset }));
}

/**
 * GET /transactions/:hash
 * Single transaction by hash, with a human-readable type label
 * (e.g. "0x69" -> "L1↔L2 Message", "0x6a" -> "System") and its parent
 * block's finalized status attached, so the frontend doesn't need a
 * second request just to render the Finalized/Pending badge. Also
 * flattens l1ToL2Message.originTxHash into l1TxHash, same as the
 * list endpoint above, so the "L1 Transaction" row on the detail
 * page has something to render.
 */
export async function getTransactionByHash(req: Request, res: Response) {
  const { hash } = req.params;

  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    return res.status(400).json({ error: "Invalid transaction hash format" });
  }

  const tx = await prisma.transaction.findUnique({
    where: { hash },
    include: {
      block: {
        select: { number: true, timestamp: true, isFinalized: true },
      },
      l1ToL2Message: { select: { originTxHash: true } },
    },
  });

  if (!tx) {
    return res.status(404).json({ error: "Transaction not found" });
  }

  const { l1ToL2Message, ...rest } = tx;
  const withLabels = withAddressLabels(rest);

  res.json(
    serializeBigInt({
      ...withLabels,
      l1TxHash: l1ToL2Message?.originTxHash ?? null,
      txTypeLabel: TX_TYPE_LABELS[tx.txType] ?? "Unknown",
      fromIsContract: await isContractAddress(rest.fromAddress, true),
      toIsContract: await isContractAddress(rest.toAddress, true),
      method: await resolveMethod(tx.functionSelector, tx.txType, true, tx.toAddress),
      decodedInput: await decodeInput(tx.input, tx.functionSelector),
      tokenTransfer: await resolveTokenTransfer(
        tx.input,
        tx.functionSelector,
        tx.toAddress,
        true
      ),
    })
  );
}

/**
 * GET /blocks/:number/transactions
 * All transactions in a given block, in execution order.
 */
export async function listTransactionsByBlock(req: Request, res: Response) {
  const number = req.params.number;

  if (!/^\d+$/.test(number)) {
    return res.status(400).json({ error: "Block number must be a positive integer" });
  }

  const transactions = await prisma.transaction.findMany({
    where: { blockNumber: BigInt(number) },
    orderBy: { transactionIndex: "asc" },
  });

  res.json(serializeBigInt((await Promise.all(transactions.map(attachMethod))).map(withAddressLabels)));
}
