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
 * A single transaction receipt as returned by eth_getBlockReceipts.
 * Carries the two receipt-only fields needed for the ACTUAL tx fee
 * (gasUsed × effectiveGasPrice), which the plain block/tx object does
 * not include. All numeric fields arrive as hex strings.
 */
export interface RawLog {
  address: string;
  topics: string[];
  data: string;
  logIndex: string;
}

export interface RawReceipt {
  transactionHash: string;
  transactionIndex: string;
  gasUsed: string;
  effectiveGasPrice: string;
  // Present on eth_getBlockReceipts; used by the token-transfer
  // indexer to decode ERC-20 Transfer events. Optional so existing
  // callers that ignore logs still type-check.
  logs?: RawLog[];
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
  // Receipt-derived (eth_getBlockReceipts). Null until backfilled for
  // older rows that were indexed before receipts were fetched.
  gasUsed: bigint | null;
  effectiveGasPrice: string | null;
}

/**
 * Known Arbitrum/Robinhood Chain transaction types worth labeling
 * distinctly in the UI, based on what we've observed on mainnet.
 * Verified against Arbitrum/Ethereum API differences docs
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


/**
 * Curated map of common 4-byte function selectors to human-readable
 * method names, mirroring what Etherscan/Arbiscan show in the Method
 * column. Selectors are lowercase. Extend as new ones are observed.
 */
export const METHOD_SIGNATURES: Record<string, string> = {
  "0xa9059cbb": "Token Transfer",
  "0x095ea7b3": "Approve",
  "0x23b872dd": "Transfer From",
  "0x42842e0e": "NFT Transfer",
  "0xb88d4fde": "NFT Transfer",
  "0xf242432a": "NFT Transfer",
  "0x2eb2c2d6": "NFT Transfer",
  "0xa22cb465": "Set Approval For All",
  "0x39509351": "Increase Allowance",
  "0xa457c2d7": "Decrease Allowance",
  "0x40c10f19": "Mint",
  "0x42966c68": "Burn",
  "0x2e1a7d4d": "Withdraw",
  "0xd0e30db0": "Deposit",
  "0x3ccfd60b": "Withdraw",
  "0xf305d719": "Add Liquidity ETH",
  "0xe8e33700": "Add Liquidity",
  "0xbaa2abde": "Remove Liquidity",
  "0x38ed1739": "Swap Exact Tokens For Tokens",
  "0x7ff36ab5": "Swap Exact ETH For Tokens",
  "0x18cbafe5": "Swap Exact Tokens For ETH",
  "0xfb3bdb41": "Swap ETH For Exact Tokens",
  "0x4a25d94a": "Swap Tokens For Exact ETH",
  "0x8803dbee": "Swap Tokens For Exact Tokens",
  "0x6a761202": "Exec Transaction",
  "0xac9650d8": "Multicall",
  "0x5ae401dc": "Multicall",
  "0x3593564c": "Execute",
  "0x24856bc3": "Execute",
  "0x04e45aaf": "Swap",
  "0xe6cb474f": "Swap",
  "0xb6f9de95": "Swap",
  "0x791ac947": "Swap",
  "0xf2c42696": "Swap",
  "0xcce7ec13": "Buy",
  "0x87517c45": "Approve",
  "0x765e827f": "Handle Ops",
  "0x4d819a2a": "Swap",
  "0x3e0f9c3c": "Swap",
  "0x0a2b8f36": "Multicall",
  "0xd505accf": "Permit", // ERC-2612 permit(...)
  "0x414bf389": "Swap", // Uniswap V3 exactInputSingle
  "0xc04b8d59": "Swap", // Uniswap V3 exactInput
  "0x5023b4df": "Swap", // Uniswap V3 exactOutputSingle
  "0x09b81346": "Swap", // Uniswap V3 exactOutput
  "0xa694fc3a": "Stake", // stake(uint256)
  "0x3d18b912": "Claim Rewards", // getReward()
  "0xe9fad8ee": "Exit", // exit() — staking exit
  "0xa0712d68": "Mint", // mint(uint256)
  "0x1249c58b": "Mint", // mint()
  "0x79cc6790": "Burn From", // burnFrom(address,uint256)
  "0x1fad948c": "Handle Ops", // ERC-4337 EntryPoint v0.6 handleOps
  "0x8d80ff0a": "Multi Send", // Gnosis Safe multiSend(bytes)
};

/**
 * Whether a txType is ArbOS's internal per-block housekeeping tx
 * ("0x6a") — the canonical check, used by getMethodLabel below and by
 * every "System tx" badge in the UI, so the definition lives in
 * exactly one place instead of the literal "0x6a" being repeated at
 * each call site.
 */
export function isSystemTxType(txType: string | null | undefined): boolean {
  return txType === "0x6a";
}

/**
 * Whether a txType is a real L1->L2 retryable-ticket message
 * ("0x69") — see isSystemTxType above for why this is centralized.
 */
export function isL1ToL2TxType(txType: string | null | undefined): boolean {
  return txType === "0x69";
}

/**
 * Derive a human-readable Method label from a transaction's function
 * selector and tx type, matching the Etherscan/Arbiscan Method column.
 * Priority: System (0x6a) > L1->L2 (0x69) > empty calldata (Transfer)
 * > curated selector name > raw 10-char selector.
 */
export function getMethodLabel(
  selector: string | null | undefined,
  txType?: string | null
): string {
  if (isSystemTxType(txType)) return "System";
  if (isL1ToL2TxType(txType)) return "L1↔L2 Message";

  const sel = (selector ?? "").trim().toLowerCase();
  if (!sel || sel === "0x") return "Transfer";

  const known = METHOD_SIGNATURES[sel];
  if (known) return known;

  return sel.length >= 10 ? sel.slice(0, 10) : sel;
}
