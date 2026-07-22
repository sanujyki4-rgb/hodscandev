import { prisma } from "@hoodscan/database";
import type { RawReceipt } from "@hoodscan/types";

/**
 * Layer 3 — persist ALL event logs emitted during a block's transactions,
 * decoded from the transaction receipts the indexer already fetches
 * (eth_getBlockReceipts). Powers the address/contract "Events" tab.
 *
 * Self-reliant: the logs come from the SAME receipts used for token/NFT
 * transfers, so there are NO extra RPC round-trips. topic0 is the event
 * signature hash; topic1..3 are the indexed params (0-3 of them). Rows are
 * idempotent on (txHash, logIndex).
 */

export type LogRow = {
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  timestamp: Date;
  address: string;
  topic0: string | null;
  topic1: string | null;
  topic2: string | null;
  topic3: string | null;
  data: string;
};

/** Extract every event log from a block's receipts. Best-effort; never throws. */
export function extractLogs(
  receipts: RawReceipt[],
  blockNumber: bigint,
  timestamp: Date
): LogRow[] {
  const rows: LogRow[] = [];

  for (const receipt of receipts) {
    const logs = receipt.logs ?? [];
    for (const log of logs) {
      let logIndex: number;
      try {
        logIndex = Number.parseInt(log.logIndex, 16);
      } catch {
        continue;
      }
      if (!Number.isFinite(logIndex)) continue;

      const topics = log.topics ?? [];
      rows.push({
        txHash: receipt.transactionHash,
        logIndex,
        blockNumber,
        timestamp,
        address: (log.address ?? "").toLowerCase(),
        topic0: topics[0] ? topics[0].toLowerCase() : null,
        topic1: topics[1] ? topics[1].toLowerCase() : null,
        topic2: topics[2] ? topics[2].toLowerCase() : null,
        topic3: topics[3] ? topics[3].toLowerCase() : null,
        data: log.data ?? "0x",
      });
    }
  }

  return rows;
}

/**
 * Bulk-insert log rows. skipDuplicates + the (txHash, logIndex) unique
 * constraint make this idempotent — re-processing a block never double-inserts.
 */
export async function saveLogs(rows: LogRow[]) {
  if (rows.length === 0) return { count: 0 };
  return prisma.log.createMany({ data: rows, skipDuplicates: true });
}
