const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface BlockSummary {
  number: string;
  hash: string;
  timestamp: string;
  txCount: number;
  gasUsed: string;
  gasLimit: string;
  isFinalized: boolean;
}

export interface TransactionSummary {
  hash: string;
  blockNumber: string;
  transactionIndex: number;
  fromAddress: string;
  toAddress: string | null;
  value: string;
  txType: string;
  functionSelector: string | null;
  /**
   * The real Ethereum L1 transaction hash that created this L1→L2
   * message (via the Bridge contract's retryable ticket, txType
   * "0x69"). Populated by apps/indexer's jobs/watchL1Messages.ts,
   * which watches the Bridge contract on L1 and links messages back
   * to their L2 tx via requestId (see L1ToL2Message in the Prisma
   * schema). Still nullable: the L1 watcher runs on its own interval
   * and may not have matched a very recent message yet, and messages
   * from before the watcher started won't be linked unless backfilled.
   */
  l1TxHash?: string | null;
  block?: {
    timestamp: string;
    isFinalized: boolean;
    l1BlockNumber?: string;
  };
}

export interface TransactionDetail extends TransactionSummary {
  txTypeLabel: string;
  gas: string;
  gasPrice: string | null;
  maxFeePerGas: string | null;
  maxPriorityFeePerGas: string | null;
  input: string;
  block: {
    number: string;
    timestamp: string;
    isFinalized: boolean;
  };
}

export interface BlockDetail extends BlockSummary {
  parentHash: string;
  gasLimit: string;
  baseFeePerGas: string;
  l1BlockNumber: string;
  transactions: TransactionSummary[];
}

/**
 * One row of an L1->L2 message (Bridge contract retryable ticket).
 * Unlike TransactionSummary, this does NOT always have an L2 side —
 * a message can exist on L1 (status "initiated", l2TxHash null)
 * before its ticket has landed on Robinhood Chain at all. Mirrors
 * Arbiscan's txsDeposits: "Pending Confirmation" rows are real rows
 * here too, not an error state.
 */
export interface L1ToL2MessageSummary {
  id: string; // queue index, from the L1 Bridge contract's MessageDelivered event
  originBlockNumber: string; // L1 (Ethereum) block number
  originTxHash: string; // L1 transaction hash
  originAddress: string; // L1 sender ("L1 Tx Origin")
  originTimestamp: string;
  status: "initiated" | "relayed";
  l2TxHash: string | null; // null while status is "initiated"
  l2Block: { number: string; timestamp: string | null; isFinalized: boolean } | null;
}

async function apiFetch<T>(path: string, revalidate = 5): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      next: { revalidate },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    console.error(`[api] Failed to fetch ${path}:`, err);
    return null;
  }
}

export function getLatestBlocks(limit = 20) {
  return apiFetch<BlockSummary[]>(`/blocks?limit=${limit}`, 2);
}

export function getLatestTransactions(limit = 15) {
  return apiFetch<TransactionSummary[]>(`/transactions?limit=${limit}`, 2);
}

export function getLatestL1ToL2Transactions(limit = 15) {
  return apiFetch<L1ToL2MessageSummary[]>(`/transactions/l1-to-l2?limit=${limit}`, 2);
}

export function getPaginatedL1ToL2Transactions(limit = 25, offset = 0) {
  return apiFetch<{
    transactions: L1ToL2MessageSummary[];
    total: number;
    limit: number;
    offset: number;
  }>(`/transactions/l1-to-l2?limit=${limit}&offset=${offset}`, 2);
}

export function getPaginatedBlocks(limit = 25, offset = 0) {
  return apiFetch<{ blocks: BlockSummary[]; total: number; limit: number; offset: number }>(
    `/blocks?limit=${limit}&offset=${offset}`,
    2
  );
}

export function getPaginatedTransactions(limit = 25, offset = 0) {
  return apiFetch<{
    transactions: TransactionSummary[];
    total: number;
    limit: number;
    offset: number;
  }>(`/transactions?limit=${limit}&offset=${offset}`, 2);
}

export function getBlockByNumber(number: string) {
  return apiFetch<BlockDetail>(`/blocks/${number}`, 30);
}

export function getTransactionByHash(hash: string) {
  return apiFetch<TransactionDetail>(`/transactions/${hash}`, 15);
}

export function getTransactionsByAddress(address: string, limit = 20, offset = 0) {
  return apiFetch<{
    address: string;
    total: number;
    limit: number;
    offset: number;
    transactions: TransactionSummary[];
  }>(`/address/${address}/transactions?limit=${limit}&offset=${offset}`, 5);
}
