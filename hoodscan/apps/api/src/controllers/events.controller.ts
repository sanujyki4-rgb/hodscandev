import type { Request, Response } from "express";
import { prisma } from "@hoodscan/database";
import { serializeBigInt } from "../utils/serialize";
import { parsePagination } from "../utils/pagination";
import { EXPLORER_LIST_CAP } from "@hoodscan/config";
import { isValidAddress } from "../utils/address";
import { decodeEventLog2 } from "../utils/eventDecoder";

/**
 * Canonical topic0 (event-signature keccak hashes) → friendly event names, for
 * the common ERC-20/721/1155 events. Anything not in this map is shown by its
 * raw topic0 in the UI. These are well-known constants, so no hashing needed.
 */
const EVENT_NAMES: Record<string, string> = {
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef":
    "Transfer",
  "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925":
    "Approval",
  "0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31":
    "ApprovalForAll",
  "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62":
    "TransferSingle",
  "0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb":
    "TransferBatch",
  "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1":
    "Sync",
  "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822":
    "Swap",
};

/**
 * GET /address/:address/events?limit=25&offset=0
 *
 * Event logs EMITTED BY the address (the contract), newest first, from the Log
 * table the indexer populates from receipts (address/contract "Events" tab).
 * topic0 is decoded to a friendly event name when it's a well-known signature;
 * the raw topics + data are always returned so the UI can show the full log.
 */
export async function listAddressEvents(req: Request, res: Response) {
  if (!isValidAddress(req.params.address)) {
    return res.status(400).json({ error: "Invalid address format" });
  }
  const address = req.params.address.toLowerCase();
  const { limit, offset } = parsePagination(req, 25, 100);

  const where = { address };

  const [logs, total] = await Promise.all([
    prisma.log.findMany({
      where,
      orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }],
      take: limit,
      skip: offset,
    }),
    prisma.log.count({ where }),
  ]);

  const events = await Promise.all(
    logs.map(async (l) => {
      const topics = [l.topic0, l.topic1, l.topic2, l.topic3].filter(
        (t): t is string => !!t
      );

      // Full decode (verified ABI first, then OpenChain signature DB). Best-
      // effort: a decode failure just leaves `decoded` null and we fall back
      // to the static well-known-name map for the display name.
      let decoded = null;
      try {
        decoded = await decodeEventLog2(l);
      } catch {
        decoded = null;
      }
      const staticName = l.topic0 ? (EVENT_NAMES[l.topic0] ?? null) : null;

      return {
        txHash: l.txHash,
        logIndex: l.logIndex,
        blockNumber: l.blockNumber,
        timestamp: l.timestamp,
        address: l.address,
        topic0: l.topic0,
        eventName: decoded?.name ?? staticName,
        topics,
        data: l.data,
        decoded,
      };
    })
  );

  res.json(
    serializeBigInt({
      address,
      total: Math.min(total, EXPLORER_LIST_CAP),
      limit,
      offset,
      events,
    })
  );
}
