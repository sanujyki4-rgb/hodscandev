import { rpcClient, getBlockReceipts } from "../rpc/client";
import { decodeBlock, decodeTransaction } from "../rpc/decoder";
import { saveBlock } from "../services/blockService";
import { saveTransactions } from "../services/transactionService";
import { extractTokenTransfers, saveTokenTransfers } from "../services/tokenTransferService";
import { extractNftTransfers, saveNftTransfers } from "../services/nftTransferService";
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

  // Same receipts → ERC-721 / ERC-1155 transfers for the NFT tab.
  // (Previously only the NFT backfill job wrote these, so live blocks
  // could lag until backfill caught up.)
  const nftTransfers = extractNftTransfers(receipts, block.number, block.timestamp);
  await saveNftTransfers(nftTransfers);

  return block.number;
}
