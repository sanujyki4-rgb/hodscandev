import { prisma } from "@hoodscan/database";
import { keccak256, toBytes } from "viem";
import type { RawReceipt } from "@hoodscan/types";

/**
 * Layer 3 — persist ERC-20 Transfer events, decoded from transaction
 * receipt logs, into the TokenTransfer table. Powers the address page's
 * "Token Transfers (ERC-20)" tab.
 *
 * Self-reliant: the logs come from the same eth_getBlockReceipts call
 * the indexer already makes per block (RPC = the user's own node), so
 * there are NO extra network round-trips and no external APIs.
 *
 * The Transfer topic is COMPUTED from its signature at load time
 * (keccak256("Transfer(address,address,uint256)")) rather than
 * hardcoded, so there's zero chance of a mistyped topic hash.
 */
const TRANSFER_TOPIC = keccak256(toBytes("Transfer(address,address,uint256)"));

export type TokenTransferRow = {
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  timestamp: Date;
  tokenAddress: string;
  fromAddress: string;
  toAddress: string;
  amount: string; // raw uint256 base-unit value, as a decimal string
};

/** Turn a 32-byte indexed address topic into a 0x-prefixed address. */
function topicToAddress(topic: string): string {
  return ("0x" + topic.slice(-40)).toLowerCase();
}

/**
 * Extract ERC-20 Transfer rows from a block's receipts.
 *
 * An ERC-20 Transfer log has topic0 === TRANSFER_TOPIC, EXACTLY three
 * topics (from + to are indexed) and a non-empty data word (the
 * amount). An ERC-721 Transfer shares the same topic0 but has FOUR
 * topics (tokenId is indexed) and empty data — those are skipped here
 * because their third value is a tokenId, not a fungible amount (NFTs
 * are surfaced via the "NFT Transfer" method label instead).
 *
 * Best-effort: any malformed log is skipped, never throws.
 */
export function extractTokenTransfers(
  receipts: RawReceipt[],
  blockNumber: bigint,
  timestamp: Date
): TokenTransferRow[] {
  const rows: TokenTransferRow[] = [];

  for (const receipt of receipts) {
    const logs = receipt.logs ?? [];
    for (const log of logs) {
      const topics = log.topics ?? [];
      if ((topics[0] ?? "").toLowerCase() !== TRANSFER_TOPIC) continue;
      if (topics.length !== 3) continue; // ERC-20 only (ERC-721 has 4)

      const data = (log.data ?? "").trim();
      if (!data || data === "0x") continue;

      let amount: bigint;
      try {
        amount = BigInt(data);
      } catch {
        continue;
      }

      let logIndex: number;
      try {
        logIndex = Number.parseInt(log.logIndex, 16);
      } catch {
        continue;
      }
      if (!Number.isFinite(logIndex)) continue;

      rows.push({
        txHash: receipt.transactionHash,
        logIndex,
        blockNumber,
        timestamp,
        tokenAddress: (log.address ?? "").toLowerCase(),
        fromAddress: topicToAddress(topics[1] ?? ""),
        toAddress: topicToAddress(topics[2] ?? ""),
        amount: amount.toString(),
      });
    }
  }

  return rows;
}

/**
 * Bulk-insert token-transfer rows. skipDuplicates + the (txHash,
 * logIndex) unique constraint make this idempotent — re-processing a
 * block never double-inserts.
 */
export async function saveTokenTransfers(rows: TokenTransferRow[]) {
  if (rows.length === 0) return { count: 0 };
  const result = await prisma.tokenTransfer.createMany({ data: rows, skipDuplicates: true });

  // Keep the per-day analytics rollup (TokenDailyStat) fresh. Recompute
  // ONLY the (tokenAddress, UTC-day) pairs this batch touched — each is a
  // small, index-backed slice (tt_token_ts_idx). Best-effort: a rollup
  // failure must NEVER break indexing, so errors are swallowed here.
  try {
    const seen = new Set<string>();
    for (const row of rows) {
      const ts = row.timestamp;
      const dayStart = new Date(
        Date.UTC(ts.getUTCFullYear(), ts.getUTCMonth(), ts.getUTCDate())
      );
      const token = row.tokenAddress.toLowerCase();
      const key = `${token}|${dayStart.toISOString()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const dayEnd = new Date(dayStart);
      dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

      await prisma.$executeRaw`
        INSERT INTO "TokenDailyStat" ("tokenAddress", "day", "transfers", "senders", "receivers", "updatedAt")
        SELECT
          "tokenAddress",
          date_trunc('day', "timestamp") AS day,
          COUNT(*)::int,
          COUNT(DISTINCT "fromAddress")::int,
          COUNT(DISTINCT "toAddress")::int,
          NOW()
        FROM "TokenTransfer"
        WHERE "tokenAddress" = ${token}
          AND "timestamp" >= ${dayStart}
          AND "timestamp" < ${dayEnd}
        GROUP BY "tokenAddress", date_trunc('day', "timestamp")
        ON CONFLICT ("tokenAddress", "day") DO UPDATE SET
          "transfers" = EXCLUDED."transfers",
          "senders" = EXCLUDED."senders",
          "receivers" = EXCLUDED."receivers",
          "updatedAt" = NOW()
      `;
    }
  } catch (err) {
    console.error("[tokenTransferService] TokenDailyStat rollup update failed:", err);
  }

  return result;
}
