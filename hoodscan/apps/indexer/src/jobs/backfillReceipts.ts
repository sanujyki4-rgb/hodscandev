import { prisma } from "@hoodscan/database";
import {
  RECEIPT_BACKFILL_BATCH_BLOCKS,
  RECEIPT_BACKFILL_DELAY_MS,
} from "@hoodscan/config";
import { getBlockReceipts } from "../rpc/client";
import { hexToBigInt } from "../rpc/decoder";
import { updateTransactionReceipts } from "../services/transactionService";

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/**
 * Backfill actual-fee fields (gasUsed, effectiveGasPrice) for older
 * transactions that were indexed before receipts were fetched.
 *
 * Scans blocks that still have receipt-less transactions, newest-first,
 * in small throttled batches — one eth_getBlockReceipts call per block,
 * with a pause between blocks — to respect the rate-limited public RPC.
 * Idempotent and resumable: once a row's gasUsed is set it drops out of
 * the query, so re-running just continues where it left off.
 */
export async function backfillReceipts(): Promise<void> {
  let processedBlocks = 0;

  while (true) {
    const blocks = await prisma.transaction.findMany({
      where: { gasUsed: null },
      distinct: ["blockNumber"],
      select: { blockNumber: true },
      orderBy: { blockNumber: "desc" },
      take: RECEIPT_BACKFILL_BATCH_BLOCKS,
    });

    if (blocks.length === 0) {
      console.log(
        `[backfillReceipts] Done — no transactions left without receipts ` +
          `(backfilled ${processedBlocks} block(s)).`
      );
      return;
    }

    let updatesThisBatch = 0;

    for (const { blockNumber } of blocks) {
      try {
        const hexNumber = "0x" + blockNumber.toString(16);
        const receipts = await getBlockReceipts(hexNumber);
        const updates = receipts
          .filter((r) => r.gasUsed != null)
          .map((r) => ({
            hash: r.transactionHash,
            gasUsed: hexToBigInt(r.gasUsed),
            effectiveGasPrice: r.effectiveGasPrice
              ? hexToBigInt(r.effectiveGasPrice).toString()
              : null,
          }));
        await updateTransactionReceipts(updates);
        updatesThisBatch += updates.length;
        processedBlocks++;
      } catch (err) {
        console.error(`[backfillReceipts] block ${blockNumber} failed:`, err);
      }
      // Throttle between blocks to avoid hammering the public RPC.
      await sleep(RECEIPT_BACKFILL_DELAY_MS);
    }

    // Safety valve: if a whole batch yielded no receipt updates, stop
    // rather than spin forever on blocks the RPC can't return receipts for.
    if (updatesThisBatch === 0) {
      console.warn(
        "[backfillReceipts] A full batch produced no receipt updates — " +
          "stopping to avoid an infinite loop. Re-run later if this was transient."
      );
      return;
    }

    console.log(
      `[backfillReceipts] Backfilled ${blocks.length} block(s); continuing…`
    );
  }
}
