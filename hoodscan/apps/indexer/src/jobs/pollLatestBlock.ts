import { rpcClient, getBlockReceipts } from "../rpc/client";
import { decodeBlock, decodeTransaction } from "../rpc/decoder";
import { saveBlock } from "../services/blockService";
import { saveTransactions } from "../services/transactionService";
import { extractTokenTransfers, saveTokenTransfers } from "../services/tokenTransferService";
import { applyTokenBalanceUpdates } from "../services/tokenBalanceService";
import { extractNftTransfers, saveNftTransfers } from "../services/nftTransferService";
import { extractLogs, saveLogs } from "../services/logService";
import {
  indexBlockInternalTransactions,
  internalTxIndexingEnabled,
} from "../rpc/traceOnDemand";
import type { RawBlock, RawTransaction } from "@hoodscan/types";

/**
 * Fetch the latest block (with full transaction objects) and persist
 * it along with all its transactions. Returns the indexed block
 * number, or null if the block was already indexed (no-op).
 */
export async function pollLatestBlock(): Promise<bigint | null> {
  // includeTransactions=true avoids a second round-trip per tx hash —
  // see the design note from our earlier RPC exploration.
  const raw = (await rpcClient.request({
    method: "eth_getBlockByNumber",
    params: ["latest", true],
  })) as unknown as RawBlock;

  if (!raw) return null;

  const block = decodeBlock(raw);
  await saveBlock(block);

  const rawTxs = raw.transactions as RawTransaction[];
  // One eth_getBlockReceipts call per block gives gasUsed +
  // effectiveGasPrice for every tx, so we can store the actual fee.
  const receipts = await getBlockReceipts(raw.number);
  const receiptByHash = new Map(
    receipts.map((r) => [r.transactionHash.toLowerCase(), r])
  );
  const decodedTxs = rawTxs.map((tx) =>
    decodeTransaction(tx, receiptByHash.get(tx.hash.toLowerCase()))
  );
  await saveTransactions(decodedTxs);

  // Layer 3: decode ERC-20 Transfer events from the same receipts
  // and persist them for the address token-transfers tab.
  const tokenTransfers = extractTokenTransfers(receipts, block.number, block.timestamp);
  await saveTokenTransfers(tokenTransfers);
  // Same rows (no extra RPC) -> maintain live TokenBalance + Token aggregates.
  await applyTokenBalanceUpdates(tokenTransfers, block.number);

  // Same receipts → ERC-721 / ERC-1155 transfers for the NFT tab.
  // (Previously only the NFT backfill job wrote these, so live blocks
  // could lag until backfill caught up.)
  const nftTransfers = extractNftTransfers(receipts, block.number, block.timestamp);
  await saveNftTransfers(nftTransfers);

  // All event logs from the same receipts (no extra RPC) -> the "Events" tab.
  await saveLogs(extractLogs(receipts, block.number, block.timestamp));

  // Best-effort: trace this block's call frames and persist internal txns
  // idempotently. Env-gated; swallows its own errors so it can never break
  // live indexing.
  if (internalTxIndexingEnabled()) {
    await indexBlockInternalTransactions(block.number, block.timestamp);
  }

  return block.number;
}
