import { prisma } from "@hoodscan/database";
import { keccak256, toBytes, decodeAbiParameters, parseAbiParameters } from "viem";
import type { RawReceipt } from "@hoodscan/types";

/**
 * Layer 3 — persist NFT transfer events (ERC-721 + ERC-1155), decoded
 * from transaction receipt logs, into the NftTransfer table. Powers the
 * address page's conditional "NFT Transfers" tab.
 *
 * Like tokenTransferService, this is self-reliant: the logs come from the
 * same eth_getBlockReceipts call the indexer already makes per block, so
 * there are NO extra network round-trips and no external APIs.
 *
 * Topics are COMPUTED from their signatures at load time so there's zero
 * chance of a mistyped topic hash.
 *
 *  - ERC-721 Transfer(address,address,uint256): shares topic0 with the
 *    ERC-20 Transfer, but has FOUR topics (tokenId is the 3rd indexed
 *    arg) and empty data. The ERC-20 service deliberately skips these.
 *  - ERC-1155 TransferSingle(operator,from,to,id,value): id + value live
 *    in the data word; from/to are indexed topics 2 & 3 (topic 1 is the
 *    operator).
 *  - ERC-1155 TransferBatch(operator,from,to,ids[],values[]): one row per
 *    (id, value) pair — batchIndex keeps (txHash, logIndex, batchIndex)
 *    unique.
 */
const TRANSFER_TOPIC = keccak256(toBytes("Transfer(address,address,uint256)"));
const TRANSFER_SINGLE_TOPIC = keccak256(
  toBytes("TransferSingle(address,address,address,uint256,uint256)")
);
const TRANSFER_BATCH_TOPIC = keccak256(
  toBytes("TransferBatch(address,address,address,uint256[],uint256[])")
);

export type NftStandard = "erc721" | "erc1155";

export type NftTransferRow = {
  txHash: string;
  logIndex: number;
  batchIndex: number;
  blockNumber: bigint;
  timestamp: Date;
  tokenAddress: string;
  fromAddress: string;
  toAddress: string;
  tokenId: string; // uint256, as a decimal string
  amount: string; // "1" for ERC-721; the transferred value for ERC-1155
  standard: NftStandard;
};

/** Turn a 32-byte indexed address topic into a 0x-prefixed address. */
function topicToAddress(topic: string): string {
  return ("0x" + topic.slice(-40)).toLowerCase();
}

/**
 * Extract NFT transfer rows (ERC-721 + ERC-1155) from a block's receipts.
 * Best-effort: any malformed log is skipped, never throws.
 */
export function extractNftTransfers(
  receipts: RawReceipt[],
  blockNumber: bigint,
  timestamp: Date
): NftTransferRow[] {
  const rows: NftTransferRow[] = [];

  for (const receipt of receipts) {
    const logs = receipt.logs ?? [];
    for (const log of logs) {
      const topics = log.topics ?? [];
      const topic0 = (topics[0] ?? "").toLowerCase();

      let logIndex: number;
      try {
        logIndex = Number.parseInt(log.logIndex, 16);
      } catch {
        continue;
      }
      if (!Number.isFinite(logIndex)) continue;

      const tokenAddress = (log.address ?? "").toLowerCase();

      // --- ERC-721 Transfer (same topic0 as ERC-20, but 4 topics) ---
      if (topic0 === TRANSFER_TOPIC && topics.length === 4) {
        let tokenId: string;
        try {
          tokenId = BigInt(topics[3] ?? "0x0").toString();
        } catch {
          continue;
        }
        rows.push({
          txHash: receipt.transactionHash,
          logIndex,
          batchIndex: 0,
          blockNumber,
          timestamp,
          tokenAddress,
          fromAddress: topicToAddress(topics[1] ?? ""),
          toAddress: topicToAddress(topics[2] ?? ""),
          tokenId,
          amount: "1",
          standard: "erc721",
        });
        continue;
      }

      // --- ERC-1155 TransferSingle ---
      if (topic0 === TRANSFER_SINGLE_TOPIC && topics.length === 4) {
        const data = (log.data ?? "").replace(/^0x/, "");
        if (data.length < 128) continue;
        let tokenId: string;
        let value: string;
        try {
          tokenId = BigInt("0x" + data.slice(0, 64)).toString();
          value = BigInt("0x" + data.slice(64, 128)).toString();
        } catch {
          continue;
        }
        rows.push({
          txHash: receipt.transactionHash,
          logIndex,
          batchIndex: 0,
          blockNumber,
          timestamp,
          tokenAddress,
          fromAddress: topicToAddress(topics[2] ?? ""),
          toAddress: topicToAddress(topics[3] ?? ""),
          tokenId,
          amount: value,
          standard: "erc1155",
        });
        continue;
      }

      // --- ERC-1155 TransferBatch ---
      if (topic0 === TRANSFER_BATCH_TOPIC && topics.length === 4) {
        let ids: readonly bigint[];
        let values: readonly bigint[];
        try {
          const decoded = decodeAbiParameters(
            parseAbiParameters("uint256[], uint256[]"),
            (log.data ?? "0x") as `0x${string}`
          );
          ids = decoded[0] as readonly bigint[];
          values = decoded[1] as readonly bigint[];
        } catch {
          continue;
        }
        const fromAddress = topicToAddress(topics[2] ?? "");
        const toAddress = topicToAddress(topics[3] ?? "");
        const n = Math.min(ids.length, values.length);
        for (let i = 0; i < n; i++) {
          rows.push({
            txHash: receipt.transactionHash,
            logIndex,
            batchIndex: i,
            blockNumber,
            timestamp,
            tokenAddress,
            fromAddress,
            toAddress,
            tokenId: ids[i].toString(),
            amount: values[i].toString(),
            standard: "erc1155",
          });
        }
        continue;
      }
    }
  }

  return rows;
}

/**
 * Bulk-insert NFT-transfer rows. skipDuplicates + the (txHash, logIndex,
 * batchIndex) unique constraint make this idempotent — re-processing a
 * block never double-inserts.
 */
export async function saveNftTransfers(rows: NftTransferRow[]) {
  if (rows.length === 0) return { count: 0 };
  return prisma.nftTransfer.createMany({ data: rows, skipDuplicates: true });
}
