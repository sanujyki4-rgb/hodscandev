/**
 * Shape of a transaction object as returned by the Robinhood Chain
 * JSON-RPC endpoint when a block is fetched with the "include full
 * transactions" flag (eth_getBlockByNumber params: [blockTag, true]).
 * All numeric fields arrive as hex strings.
 */
export interface RawTransaction {
  hash: string;
  blockHash: string;
  blockNumber: string;
  transactionIndex: string;
  from: string;
  to: string | null;
  nonce: string;
  value: string;
  input: string;
  gas: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  type: string;
  chainId?: string;
  v?: string;
  r?: string;
  s?: string;
  accessList?: unknown[];
  // Only present on Arbitrum-native tx types ("0x68"-"0x6a"). For
  // txType "0x69" (ArbitrumSubmitRetryableTxType), this is the id
  // used to match this L2 tx back to its originating L1 message —
  // see L1ToL2Message in the Prisma schema and jobs/watchL1Messages.ts.
  requestId?: string;
}

/**
 * Decoded transaction, ready to persist via packages/database.
 */
export interface DecodedTransaction {
  hash: string;
  blockNumber: bigint;
  transactionIndex: number;
  fromAddress: string;
  toAddress: string | null;
  nonce: bigint;
  value: string; // kept as string to preserve full wei precision
  gas: bigint;
  gasPrice: string | null;
  maxFeePerGas: string | null;
  maxPriorityFeePerGas: string | null;
  input: string;
  functionSelector: string | null; // first 4 bytes of input, e.g. "0x095ea7b3"
  txType: string; // "0x0", "0x2", "0x69" (real L1->L2 retryable ticket), "0x6a" (Arbitrum internal/housekeeping tx), etc.
  requestId: string | null; // only set for txType "0x69"
}

/**
 * Known Arbitrum/Robinhood Chain transaction types worth labeling
 * distinctly in the UI, based on what we've observed on mainnet.
 * Verified against Alchemy's Arbitrum/Ethereum API differences doc
 * and the go-ethereum-arbitrum source (core/types transaction type
 * constants) — "0x69" is the real L1->L2 message type; "0x6a" is
 * NOT an L1->L2 message, it's ArbOS's own per-block housekeeping tx.
 */
export const TX_TYPE_LABELS: Record<string, string> = {
  "0x0": "Legacy",
  "0x2": "EIP-1559",
  "0x69": "L1↔L2 Message",
  "0x6a": "System",
};
