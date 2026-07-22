import type { Request, Response } from "express";
import { prisma } from "@hoodscan/database";
import { serializeBigInt } from "../utils/serialize";
import { parsePagination } from "../utils/pagination";
import { cappedCount } from "../utils/count";

/**
 * GET /blocks?limit=20&offset=0
 * Latest blocks, newest first. Always returns the paginated envelope
 * { blocks, total, limit, offset } — the same shape whether or not an
 * offset is passed — so consumers never have to branch on the response
 * type. Callers that only need the rows (e.g. the homepage panel) read
 * `.blocks`.
 */
export async function listLatestBlocks(req: Request, res: Response) {
  const { limit, offset } = parsePagination(req, 20, 100);

  const [blocks, total] = await Promise.all([
    prisma.block.findMany({
      // Explicit scalar select: keeps the JSON shape identical while
      // guaranteeing the `transactions` relation is never lazily loaded
      // for the list view (only the block header fields are needed here).
      select: {
        number: true,
        hash: true,
        parentHash: true,
        timestamp: true,
        gasUsed: true,
        gasLimit: true,
        baseFeePerGas: true,
        l1BlockNumber: true,
        sendCount: true,
        sendRoot: true,
        size: true,
        txCount: true,
        isFinalized: true,
      },
      orderBy: { number: "desc" },
      take: limit,
      skip: offset,
    }),
    cappedCount("Block"),
  ]);

  res.json(serializeBigInt({ blocks, total, limit, offset }));
}

/**
 * GET /blocks/:number
 * Single block by number, including its transactions.
 */
export async function getBlockByNumber(req: Request, res: Response) {
  const number = req.params.number;

  if (!/^\d+$/.test(number)) {
    return res.status(400).json({ error: "Block number must be a positive integer" });
  }

  const block = await prisma.block.findUnique({
    where: { number: BigInt(number) },
    include: {
      transactions: {
        orderBy: { transactionIndex: "asc" },
      },
    },
  });

  if (!block) {
    return res.status(404).json({ error: "Block not found" });
  }

  res.json(serializeBigInt(block));
}
