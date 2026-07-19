import { prisma } from "@hoodscan/database";
import type { DecodedTransaction } from "@hoodscan/types";
import { linkL2Transaction } from "./l1MessageService";

/**
 * Bulk-insert transactions for a block. Uses createMany with
 * skipDuplicates so re-running the same block (e.g. after a retry)
 * doesn't throw on unique hash conflicts. Also links any txType
 * "0x69" (real L1->L2 retryable ticket) transactions back to their
 * originating L1 message, if we've already indexed that message via
 * jobs/watchL1Messages.ts — if not indexed yet, this is a no-op and
 * the link gets made later when the L1 side catches up.
 */
export async function saveTransactions(transactions: DecodedTransaction[]) {
  if (transactions.length === 0) return { count: 0 };

  const result = await prisma.transaction.createMany({
    data: transactions.map((tx) => ({
      hash: tx.hash,
      blockNumber: tx.blockNumber,
      transactionIndex: tx.transactionIndex,
      fromAddress: tx.fromAddress,
      toAddress: tx.toAddress,
      nonce: tx.nonce,
      value: tx.value,
      gas: tx.gas,
      gasPrice: tx.gasPrice,
      maxFeePerGas: tx.maxFeePerGas,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
      input: tx.input,
      functionSelector: tx.functionSelector,
      txType: tx.txType,
      requestId: tx.requestId,
      gasUsed: tx.gasUsed,
      effectiveGasPrice: tx.effectiveGasPrice,
    })),
    skipDuplicates: true,
  });

  // Arbitrum: L1ToL2Message.requestId (retryableCreationId) === L2 ticket
  // creation tx hash. RPC field tx.requestId is a different value on RH.
  for (const tx of transactions) {
    if (tx.txType === "0x69") {
      await linkL2Transaction(tx.hash, tx.requestId);
    }
  }

  return result;
}

/**
 * Backfill receipt-derived fee fields (gasUsed, effectiveGasPrice) onto
 * transaction rows that were indexed before receipts were fetched.
 * Uses updateMany per hash so a missing row is a silent no-op rather
 * than throwing (unlike update()), keeping the backfill job resilient.
 */
export async function updateTransactionReceipts(
  receipts: { hash: string; gasUsed: bigint; effectiveGasPrice: string | null }[]
) {
  if (receipts.length === 0) return;
  await Promise.all(
    receipts.map((r) =>
      prisma.transaction.updateMany({
        where: { hash: r.hash },
        data: { gasUsed: r.gasUsed, effectiveGasPrice: r.effectiveGasPrice },
      })
    )
  );
}
