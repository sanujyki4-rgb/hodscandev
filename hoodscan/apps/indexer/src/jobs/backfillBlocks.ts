import { rpcClient, getBlockReceipts } from "../rpc/client";
import { decodeBlock, decodeTransaction } from "../rpc/decoder";
import { saveBlock } from "../services/blockService";
import { saveTransactions } from "../services/transactionService";
import { getLatestIndexedBlockNumber } from "../services/blockService";
import type { RawBlock, RawTransaction } from "@hoodscan/types";

/**
 * Fetch and persist a single historical block by number.
 */
async function indexBlockByNumber(blockNumber: bigint): Promise<void> {
  const hexNumber = "0x" + blockNumber.toString(16);

  const raw = (await rpcClient.request({
    method: "eth_getBlockByNumber",
    params: [hexNumber as `0x${string}`, true],
  })) as unknown as RawBlock;

  if (!raw) return;

  const block = decodeBlock(raw);
  await saveBlock(block);

  const rawTxs = raw.transactions as RawTransaction[];
  const receipts = await getBlockReceipts(hexNumber);
  const receiptByHash = new Map(
    receipts.map((r) => [r.transactionHash.toLowerCase(), r])
  );
  const decodedTxs = rawTxs.map((tx) =>
    decodeTransaction(tx, receiptByHash.get(tx.hash.toLowerCase()))
  );
  await saveTransactions(decodedTxs);
}

/**
 * Backfill missing blocks between the last indexed block and the
 * current chain head. Intended to run once on startup (catch up
 * after downtime) or manually to fill a historical range.
 *
 * Processes sequentially with a small concurrency window to avoid
 * overwhelming the public (rate-limited) RPC endpoint.
 */
export async function backfillBlocks(options?: {
  fromBlock?: bigint;
  toBlock?: bigint;
  concurrency?: number;
}): Promise<void> {
  const concurrency = options?.concurrency ?? 5;

  const latestIndexed = options?.fromBlock ?? (await getLatestIndexedBlockNumber());
  const headRaw = (await rpcClient.request({
    method: "eth_getBlockByNumber",
    params: ["latest", false],
  })) as { number: string };
  const chainHead = options?.toBlock ?? BigInt(headRaw.number);

  // Fresh database, no starting point given: nothing to backfill from,
  // caller should decide a starting block explicitly.
  if (latestIndexed === null) {
    console.warn(
      "[backfill] No indexed blocks and no fromBlock provided â€” skipping. " +
        "Pass options.fromBlock to backfill from a specific block."
    );
    return;
  }

  const start = latestIndexed + 1n;
  if (start > chainHead) {
    console.log("[backfill] Already caught up to chain head.");
    return;
  }

  console.log(`[backfill] Indexing blocks ${start} â†’ ${chainHead}...`);

  let current = start;
  while (current <= chainHead) {
    const batch: bigint[] = [];
    for (let i = 0; i < concurrency && current + BigInt(i) <= chainHead; i++) {
      batch.push(current + BigInt(i));
    }

    await Promise.all(batch.map((n) => indexBlockByNumber(n)));

    current += BigInt(batch.length);
  }

  console.log(`[backfill] Done. Indexed up to block ${chainHead}.`);
}
