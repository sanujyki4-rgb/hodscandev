import { prisma } from "@hoodscan/database";
import type { RawBlock, RawTransaction } from "@hoodscan/types";
import { rpcClient } from "../rpc/client";
import { decodeBlock, decodeTransaction } from "../rpc/decoder";
import { saveBlock } from "./blockService";

/**
 * Insert a newly-observed L1->L2 message (from the Bridge contract's
 * MessageDelivered event on Ethereum L1). Idempotent on `id`
 * (the L1 messageIndex) — safe to re-run over the same L1 block range.
 *
 * After insert, immediately tries to link an L2 ticket (retryable
 * creation tx), which may already be on chain / in the DB.
 */
export async function saveL1Message(message: {
  id: bigint;
  requestId: string;
  originTxHash: string;
  originBlockNumber: bigint;
  originTimestamp: Date;
  originAddress: string;
}) {
  const row = await prisma.l1ToL2Message.upsert({
    where: { id: message.id },
    update: {}, // L1 message data never changes once mined
    create: {
      id: message.id,
      requestId: message.requestId,
      originTxHash: message.originTxHash,
      originBlockNumber: message.originBlockNumber,
      originTimestamp: message.originTimestamp,
      originAddress: message.originAddress,
      status: "initiated",
    },
  });

  await tryLinkL1Message(message.requestId);
  return row;
}

/**
 * Link an L2 transaction to a pending L1->L2 message.
 *
 * On Arbitrum/Orbit, the retryable ticket id (`requestId` on L1ToL2Message,
 * from SDK `retryableCreationId`) is also the L2 transaction hash of the
 * ticket-creation tx (type 0x69). The optional RPC field `Transaction.requestId`
 * on Robinhood is a different value (often a padded counter) and must NOT be
 * the only match key.
 */
export async function linkL2Transaction(
  l2TxHash: string,
  rpcRequestId?: string | null
) {
  const or: { requestId: string }[] = [{ requestId: l2TxHash }];
  if (rpcRequestId && rpcRequestId.toLowerCase() !== l2TxHash.toLowerCase()) {
    or.push({ requestId: rpcRequestId });
  }

  return prisma.l1ToL2Message.updateMany({
    where: {
      l2TxHash: null,
      OR: or,
    },
    data: { l2TxHash, status: "relayed" },
  });
}

/**
 * For one L1 `requestId` (retryableCreationId): find or fetch the L2
 * ticket tx and mark the message relayed.
 */
export async function tryLinkL1Message(requestId: string): Promise<boolean> {
  // Already linked?
  const existing = await prisma.l1ToL2Message.findFirst({
    where: { requestId, l2TxHash: { not: null } },
    select: { id: true },
  });
  if (existing) return true;

  // 1) L2 ticket already in DB (hash == retryableCreationId)
  let l2Hash: string | null = null;
  const byHash = await prisma.transaction.findUnique({
    where: { hash: requestId },
    select: { hash: true },
  });
  if (byHash) {
    l2Hash = byHash.hash;
  } else {
    const byRpcField = await prisma.transaction.findFirst({
      where: { requestId },
      select: { hash: true },
    });
    if (byRpcField) l2Hash = byRpcField.hash;
  }

  // 2) Not in DB yet — fetch ticket by hash from L2 RPC (Arbitrum semantics)
  if (!l2Hash) {
    l2Hash = await fetchAndPersistL2Ticket(requestId);
  }

  if (!l2Hash) return false;

  const result = await prisma.l1ToL2Message.updateMany({
    where: { requestId, l2TxHash: null },
    data: { l2TxHash: l2Hash, status: "relayed" },
  });
  return result.count > 0;
}

/**
 * Reconcile all initiated L1 messages that still lack an L2 tx link.
 * Safe to call periodically; limited batch size per run.
 */
export async function reconcileInitiatedL1Messages(limit = 50): Promise<number> {
  const pending = await prisma.l1ToL2Message.findMany({
    where: { l2TxHash: null },
    select: { requestId: true },
    orderBy: { originBlockNumber: "asc" },
    take: limit,
  });

  let linked = 0;
  for (const msg of pending) {
    if (await tryLinkL1Message(msg.requestId)) linked++;
  }
  return linked;
}

/**
 * Fetch an L2 ticket creation tx by hash (retryableCreationId) and
 * persist its block + transaction so the FK on L1ToL2Message.l2TxHash
 * can point at Transaction.hash.
 */
async function fetchAndPersistL2Ticket(ticketHash: string): Promise<string | null> {
  const raw = (await rpcClient.request({
    method: "eth_getTransactionByHash",
    params: [ticketHash as `0x${string}`],
  })) as unknown as RawTransaction | null;

  if (!raw?.hash || !raw.blockNumber) return null;

  const blockNumber = BigInt(raw.blockNumber);
  const blockExists = await prisma.block.findUnique({
    where: { number: blockNumber },
    select: { number: true },
  });

  if (!blockExists) {
    const rawBlock = (await rpcClient.request({
      method: "eth_getBlockByNumber",
      params: [raw.blockNumber as `0x${string}`, false],
    })) as unknown as RawBlock | null;

    if (!rawBlock) return null;
    // eth_getBlockByNumber(..., false) returns tx hashes — decodeBlock
    // only needs transactions.length for txCount.
    await saveBlock(decodeBlock(rawBlock));
  }

  const decoded = decodeTransaction(raw);
  await prisma.transaction.createMany({
    data: [
      {
        hash: decoded.hash,
        blockNumber: decoded.blockNumber,
        transactionIndex: decoded.transactionIndex,
        fromAddress: decoded.fromAddress,
        toAddress: decoded.toAddress,
        nonce: decoded.nonce,
        value: decoded.value,
        gas: decoded.gas,
        gasPrice: decoded.gasPrice,
        maxFeePerGas: decoded.maxFeePerGas,
        maxPriorityFeePerGas: decoded.maxPriorityFeePerGas,
        input: decoded.input,
        functionSelector: decoded.functionSelector,
        txType: decoded.txType,
        // Store ticket id for convenience; Arbitrum hash already is the id.
        requestId: decoded.requestId ?? decoded.hash,
      },
    ],
    skipDuplicates: true,
  });

  return decoded.hash;
}

/**
 * Returns the highest L1 block number we've recorded a message from,
 * or null if we haven't indexed any L1 messages yet (fresh install —
 * caller should decide a starting block, e.g. Robinhood Chain's
 * mainnet launch block on L1, or "latest" to only watch going forward).
 */
export async function getLatestIndexedL1BlockNumber(): Promise<bigint | null> {
  const latest = await prisma.l1ToL2Message.findFirst({
    orderBy: { originBlockNumber: "desc" },
    select: { originBlockNumber: true },
  });
  return latest?.originBlockNumber ?? null;
}
