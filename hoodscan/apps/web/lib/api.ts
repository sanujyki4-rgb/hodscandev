const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * Build an absolute URL for a token logo served by our own API proxy.
 * `logo` is the API-relative path (e.g. /tokens/0x../logo) or null. Keeping
 * the proxy on our origin means the upstream (Blockscout) source is hidden.
 */
/**
 * Absolute URL for ANY address's logo via our proxy. Returns a 404 (handled
 * by the caller's onError fallback) when the address has no logo on file.
 */
export function addressLogoSrc(address: string): string {
  return `${API_BASE_URL}/tokens/${address.toLowerCase()}/logo`;
}

export function tokenLogoSrc(logo: string | null | undefined): string | null {
  return logo ? `${API_BASE_URL}${logo}` : null;
}

export interface BlockSummary {
  number: string;
  hash: string;
  timestamp: string;
  txCount: number;
  gasUsed: string;
  gasLimit: string;
  baseFeePerGas: string;
  l1BlockNumber: string;
  isFinalized: boolean;
}

export interface TransactionSummary {
  hash: string;
  blockNumber: string;
  transactionIndex: number;
  fromAddress: string;
  toAddress: string | null;
  /** Friendly label for the from-address (curated ADDRESS_LABELS), when known. */
  fromLabel?: string | null;
  /** Friendly label for the to-address (curated ADDRESS_LABELS), when known. */
  toLabel?: string | null;
  /** Whether from/to is a smart contract (drives the contract icon). */
  fromIsContract?: boolean | null;
  fromIsToken?: boolean | null;
  toIsContract?: boolean | null;
  toIsToken?: boolean | null;
  value: string;
  gas?: string;
  gasPrice?: string | null;
  maxFeePerGas?: string | null;
  maxPriorityFeePerGas?: string | null;
  // Receipt-derived actual-fee fields (gasUsed × effectiveGasPrice).
  // Null for older rows not yet backfilled with receipt data.
  gasUsed?: string | null;
  effectiveGasPrice?: string | null;
  txType: string;
  functionSelector: string | null;
  /**
   * Human-readable method label derived from functionSelector
   * (e.g. Transfer, Approve, Swap), like Etherscan/Arbiscan's Method column.
   * Returned by the API; optional so older/cached shapes still type.
   */
  method?: string;
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
  decodedInput?: {
    signature: string;
    name: string;
    args: { name: string; type: string; value: string }[];
  } | null;
  /**
   * Decoded ERC-20 token transfer (transfer/transferFrom), with the
   * amount scaled by the token's on-chain decimals and its symbol
   * resolved from the user's own RPC node. Null for non-token txs.
   */
  tokenTransfer?: {
    tokenAddress: string;
    from: string | null;
    to: string;
    rawAmount: string;
    amount: string | null;
    symbol: string | null;
    name: string | null;
    decimals: number | null;
  } | null;
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

// All list endpoints return a consistent { …, total, limit, offset }
// envelope; these "latest" helpers unwrap the rows so callers keep
// getting a plain array (or null when the API is unreachable).
export async function getLatestBlocks(limit = 20): Promise<BlockSummary[] | null> {
  const data = await apiFetch<{
    blocks: BlockSummary[];
    total: number;
    limit: number;
    offset: number;
  }>(`/blocks?limit=${limit}`, 2);
  return data ? data.blocks : null;
}

export async function getLatestTransactions(limit = 15): Promise<TransactionSummary[] | null> {
  const data = await apiFetch<{
    transactions: TransactionSummary[];
    total: number;
    limit: number;
    offset: number;
  }>(`/transactions?limit=${limit}`, 2);
  return data ? data.transactions : null;
}

export async function getLatestL1ToL2Transactions(limit = 15): Promise<L1ToL2MessageSummary[] | null> {
  // Homepage panel shows only completed (relayed) messages, matching
  // Arbiscan's homepage; the full deposits page omits the filter.
  const data = await apiFetch<{
    transactions: L1ToL2MessageSummary[];
    total: number;
    limit: number;
    offset: number;
  }>(`/transactions/l1-to-l2?limit=${limit}&status=relayed`, 2);
  return data ? data.transactions : null;
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
    label?: string | null;
    total: number;
    limit: number;
    offset: number;
    isContract?: boolean | null;
    isToken?: boolean | null;
    hasNftActivity?: boolean;
    transactions: TransactionSummary[];
  }>(`/address/${address}/transactions?limit=${limit}&offset=${offset}`, 5);
}

export interface AddressOverview {
  address: string;
  label?: string | null;
  isContract?: boolean | null;
  isToken?: boolean | null;
  /** Raw native (gas token) balance in wei, as a string; null if unavailable. */
  nativeBalance: string | null;
  nonce?: number | null;
  txCount?: number;
  hasNftActivity?: boolean;
}

/**
 * Address header/overview: native (gas token) balance, tx count, and flags.
 * Backed by GET /address/:address (eth_getBalance, short-cached).
 */
export function getAddressOverview(address: string) {
  return apiFetch<AddressOverview>(`/address/${address}`, 10);
}

export interface TokenHolding {
  tokenAddress: string;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  /** Raw base-unit balance as a string. */
  rawBalance: string;
  /** Balance scaled by decimals (formatted); null if decimals unknown. */
  balance: string | null;
  /** API-relative path to the proxied token logo, or null. */
  logo?: string | null;
}

/**
 * Current ERC-20 portfolio (holdings) for an address, ranked by balance.
 * Backed by GET /address/:address/token-holdings (reads TokenBalance).
 */
export function getAddressTokenHoldings(address: string, limit = 25, offset = 0) {
  return apiFetch<{
    address: string;
    total: number;
    limit: number;
    offset: number;
    holdings: TokenHolding[];
  }>(`/address/${address}/token-holdings?limit=${limit}&offset=${offset}`, 10);
}

export interface TokenTransferRow {
  txHash: string;
  logIndex: number;
  blockNumber: string;
  timestamp: string;
  tokenAddress: string;
  fromAddress: string;
  toAddress: string;
  rawAmount: string;
  amount: string | null;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  direction: "in" | "out" | null;
  fromLabel?: string | null;
  toLabel?: string | null;
  fromIsContract?: boolean | null;
  fromIsToken?: boolean | null;
  toIsContract?: boolean | null;
  toIsToken?: boolean | null;
  tokenIsContract?: boolean | null;
}

export function getTokenTransfersByAddress(address: string, limit = 25, offset = 0) {
  return apiFetch<{
    address: string;
    label?: string | null;
    total: number;
    limit: number;
    offset: number;
    transfers: TokenTransferRow[];
  }>(`/address/${address}/token-transfers?limit=${limit}&offset=${offset}`, 5);
}

export interface AddressContract {
  address: string;
  isContract: boolean;
  isToken?: boolean | null;
  bytecode: string;
  sizeBytes: number;
}

export function getAddressContract(address: string) {
  return apiFetch<AddressContract>(`/address/${address}/contract`, 300);
}

export interface NftTransferRow {
  txHash: string;
  logIndex: number;
  batchIndex: number;
  blockNumber: string;
  timestamp: string;
  tokenAddress: string;
  fromAddress: string;
  toAddress: string;
  tokenId: string;
  amount: string;
  standard: string;
  tokenName: string | null;
  tokenSymbol: string | null;
  direction: "in" | "out" | null;
  fromLabel?: string | null;
  toLabel?: string | null;
  fromIsContract?: boolean | null;
  fromIsToken?: boolean | null;
  toIsContract?: boolean | null;
  toIsToken?: boolean | null;
  tokenIsContract?: boolean | null;
}

export function getNftTransfersByAddress(address: string, limit = 25, offset = 0) {
  return apiFetch<{
    address: string;
    label?: string | null;
    total: number;
    limit: number;
    offset: number;
    transfers: NftTransferRow[];
  }>(`/address/${address}/nft-transfers?limit=${limit}&offset=${offset}`, 5);
}

export interface TokenListItem {
  tokenAddress: string;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  transferCount: number;
  /** API-relative path to the proxied token logo, or null. */
  logo?: string | null;
}

export function getTokens(limit = 25, offset = 0) {
  return apiFetch<{
    total: number;
    limit: number;
    offset: number;
    tokens: TokenListItem[];
  }>(`/tokens?limit=${limit}&offset=${offset}`, 10);
}

export interface TokenDetail {
  tokenAddress: string;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  isContract: boolean | null;
  isToken?: boolean | null;
  transferCount: number;
  holderCount: number;
  /** API-relative path to the proxied token logo, or null. */
  logo?: string | null;
  /** Formatted total supply (scaled by decimals); null if unavailable. */
  totalSupply: string | null;
  /** Raw uint256 total supply as a string; null if unavailable. */
  rawTotalSupply: string | null;
}

export function getTokenDetail(address: string) {
  return apiFetch<TokenDetail>(`/tokens/${address}`, 10);
}

export interface TokenTransferListRow {
  txHash: string;
  logIndex: number;
  blockNumber: string;
  timestamp: string;
  fromAddress: string;
  toAddress: string;
  rawAmount: string;
  amount: string | null;
  fromLabel?: string | null;
  toLabel?: string | null;
  fromIsContract?: boolean | null;
  fromIsToken?: boolean | null;
  toIsContract?: boolean | null;
  toIsToken?: boolean | null;
}

export function getTokenTransfers(address: string, limit = 25, offset = 0) {
  return apiFetch<{
    tokenAddress: string;
    name: string | null;
    symbol: string | null;
    decimals: number | null;
    total: number;
    limit: number;
    offset: number;
    transfers: TokenTransferListRow[];
  }>(`/tokens/${address}/transfers?limit=${limit}&offset=${offset}`, 5);
}

export interface TokenHolderRow {
  rank: number;
  address: string;
  label?: string | null;
  rawBalance: string;
  balance: string | null;
  percentage?: number | null;
  isContract?: boolean | null;
  isToken?: boolean | null;
}

export function getTokenHolders(address: string, limit = 25, offset = 0) {
  return apiFetch<{
    tokenAddress: string;
    name: string | null;
    symbol: string | null;
    decimals: number | null;
    totalSupply: string | null;
    total: number;
    limit: number;
    offset: number;
    holders: TokenHolderRow[];
  }>(`/tokens/${address}/holders?limit=${limit}&offset=${offset}`, 10);
}

/**
 * One calendar day of chain activity, aggregated from the Block table
 * (transactions, blocks, gas utilization, base fee, block size).
 * Returned oldest -> newest by GET /stats/daily.
 */
export interface DailyStatPoint {
  date: string; // YYYY-MM-DD (UTC)
  blocks: number;
  transactions: number;
  avgTxPerBlock: number;
  gasUtilPct: number; // 0..100
  avgBaseFeeGwei: number;
  avgBlockSizeBytes: number;
}

export interface DailyStatsResponse {
  days: number;
  allowedDays: number[];
  summary: {
    totalTransactions: number;
    totalBlocks: number;
    activeDays: number;
    avgTxPerDay: number;
    peakTxDay: { date: string; transactions: number } | null;
  };
  points: DailyStatPoint[];
}

export function getDailyStats(days = 30) {
  return apiFetch<DailyStatsResponse>(`/stats/daily?days=${days}`, 60);
}

export interface ContractReadFunction {
  name: string;
  stateMutability: string;
  inputs: { name: string; type: string }[];
  outputs: { type: string }[];
  hasInputs: boolean;
  /** Eagerly-resolved value for zero-argument reads; null if it reverted. */
  value: string | null;
}

export interface ReadContractResponse {
  /** "verified" when functions come from a verified ABI, else the token standard. */
  source?: "verified" | "standard";
  address: string;
  standard: "erc20" | "erc721" | "erc1155" | "verified" | null;
  supported: boolean;
  /** True when read functions come from a proxy's implementation ABI. */
  isProxy?: boolean;
  functions: ContractReadFunction[];
}

export function getReadContract(address: string) {
  return apiFetch<ReadContractResponse>(`/address/${address}/read-contract`, 30);
}

/**
 * Execute a single detected read function with user-supplied args.
 * Returns { result } on success or { error } on revert/bad input.
 */
export async function callContractRead(
  address: string,
  functionName: string,
  args: string[]
): Promise<{ result?: string; error?: string }> {
  try {
    const res = await fetch(`${API_BASE_URL}/address/${address}/read-contract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ functionName, args }),
    });
    const body = (await res.json()) as { result?: string; error?: string };
    if (!res.ok && !body.error) return { error: `Request failed (${res.status})` };
    return body;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Network error" };
  }
}

export interface TokenDailyPoint {
  date: string; // YYYY-MM-DD (UTC)
  transfers: number;
  senders: number;
  receivers: number;
}

export interface TokenDailyResponse {
  tokenAddress: string;
  days: number;
  allowedDays: number[];
  summary: {
    totalTransfers: number;
    activeDays: number;
    avgTransfersPerDay: number;
    peakDay: { date: string; transfers: number } | null;
  };
  points: TokenDailyPoint[];
}

export function getTokenDaily(address: string, days = 30) {
  return apiFetch<TokenDailyResponse>(`/tokens/${address}/daily?days=${days}`, 60);
}

export interface VerificationStatus {
  address: string;
  verified: boolean;
  contractName?: string;
  compilerVersion?: string;
  optimizationEnabled?: boolean;
  optimizationRuns?: number;
  evmVersion?: string | null;
  sourceCode?: string;
  abi?: unknown[];
  constructorArguments?: string | null;
  proxyType?: string | null;
  implementation?: {
    address: string;
    contractName: string;
    compilerVersion: string;
    sourceCode: string;
    abi: unknown[];
  } | null;
  verifiedAt?: string;
}

/** Verification status for a contract (verified source + ABI when present). */
export function getVerification(address: string) {
  return apiFetch<VerificationStatus>(`/address/${address}/verification`, 30);
}

export interface VerifyRequest {
  sourceCode: string;
  contractName: string;
  compilerVersion: string;
  optimizationEnabled: boolean;
  optimizationRuns: number;
  evmVersion?: string;
}

export interface VerifyResult extends VerificationStatus {
  error?: string;
}

/**
 * Submit source code for verification. Returns the verified record on
 * success, or { verified:false, error } on a compile error / bytecode
 * mismatch so the UI can show it inline.
 */
export async function submitVerification(
  address: string,
  payload: VerifyRequest
): Promise<VerifyResult> {
  try {
    const res = await fetch(`${API_BASE_URL}/address/${address}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json()) as VerifyResult;
    if (!res.ok && !body.error) {
      return { address, verified: false, error: `Request failed (${res.status})` };
    }
    return body;
  } catch (err) {
    return { address, verified: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

/**
 * One internal transaction (a sub-call / value transfer produced while a
 * transaction executed), decoded from a debug_trace callTracer result by
 * GET /transactions/:hash/internal. `value` is already scaled to ETH; the
 * raw wei value is in `rawValue`. gas/gasUsed are decimal strings.
 */
export interface InternalTxRow {
  traceAddress: string;
  callType: string;
  fromAddress: string;
  toAddress: string | null;
  rawValue: string;
  value: string;
  gas: string | null;
  gasUsed: string | null;
  input: string | null;
  output: string | null;
  error: string | null;
  fromLabel?: string | null;
  toLabel?: string | null;
  fromIsContract?: boolean | null;
  fromIsToken?: boolean | null;
  toIsContract?: boolean | null;
  toIsToken?: boolean | null;
}

export interface InternalTxResponse {
  txHash: string;
  total: number;
  limit: number;
  offset: number;
  /**
   * Non-null when the on-demand trace couldn't be fetched (e.g. the provider
   * doesn't support debug_trace* or the call failed). The UI shows this as a
   * note instead of failing — internalTransactions will be empty.
   */
  traceError: string | null;
  internalTransactions: InternalTxRow[];
}

/**
 * Internal transactions for a single tx hash. The API lazily traces the tx
 * on first request (traces are on-demand, never bulk-indexed), so this can be
 * a touch slower than other reads and is cached for 15s.
 */
export function getInternalTransactions(hash: string, limit = 25, offset = 0) {
  return apiFetch<InternalTxResponse>(
    `/transactions/${hash}/internal?limit=${limit}&offset=${offset}`,
    15
  );
}

/**
 * One decoded storage-slot change within an account (before/after are 32-byte
 * 0x hex values). Powers the per-account storage rows in the State tab.
 */
export interface StorageChange {
  slot: string;
  before: string;
  after: string;
}

/**
 * One account's state delta for a transaction, decoded from a prestateTracer
 * (diffMode) trace. Balances are wei decimal strings. Only accounts/slots that
 * actually changed are present.
 */
export interface StateChangeRow {
  address: string;
  balanceBefore: string;
  balanceAfter: string;
  nonceBefore: number;
  nonceAfter: number;
  storageChanges: StorageChange[];
}

export interface StateDiffResponse {
  txHash: string;
  stateChanges: StateChangeRow[];
  /** True when the provider couldn't trace the tx (graceful, not an error). */
  unavailable?: boolean;
}

/**
 * State changes ("Advanced TxInfo") for a single tx, traced on demand from a
 * prestateTracer (diffMode) result. Cached 15s like the internal-tx endpoint.
 */
export function getTransactionStateDiff(hash: string) {
  return apiFetch<StateDiffResponse>(`/transactions/${hash}/state-diff`, 15);
}

export interface UserOperationRow {
  userOpHash: string | null;
  sender: string | null;
  paymaster: string | null;
  nonce: string;
  success: boolean;
  actualGasCost: string;
  actualGasUsed: string;
  entryPoint: string;
  entryPointVersion: string | null;
  logIndex: number;
}

export interface UserOperationsResponse {
  txHash: string;
  total: number;
  userOperations: UserOperationRow[];
}

/**
 * ERC-4337 User Operations decoded from a tx's EntryPoint UserOperationEvent
 * logs. Empty for normal (non-AA) transactions. Cached 15s.
 */
export function getTransactionUserOperations(hash: string) {
  return apiFetch<UserOperationsResponse>(`/transactions/${hash}/user-operations`, 15);
}

/**
 * One address-level internal transaction (a trace sub-call / value transfer
 * where the address is the sender or recipient), read from the indexer's
 * InternalTransaction table. `value` is scaled to ETH; `rawValue` is wei.
 * Unlike the per-tx endpoint this is never traced on demand — it only returns
 * what the indexer has already persisted.
 */
export interface AddressInternalTxRow {
  txHash: string;
  blockNumber: string;
  timestamp: string;
  traceAddress: string;
  callType: string;
  fromAddress: string;
  toAddress: string | null;
  rawValue: string;
  value: string;
  gas: string | null;
  gasUsed: string | null;
  error: string | null;
  direction: "in" | "out" | null;
  fromLabel?: string | null;
  toLabel?: string | null;
  fromIsContract?: boolean | null;
  fromIsToken?: boolean | null;
  toIsContract?: boolean | null;
  toIsToken?: boolean | null;
}

export function getAddressInternalTransactions(address: string, limit = 25, offset = 0) {
  return apiFetch<{
    address: string;
    label?: string | null;
    total: number;
    limit: number;
    offset: number;
    internalTransactions: AddressInternalTxRow[];
  }>(`/address/${address}/internal?limit=${limit}&offset=${offset}`, 5);
}

/**
 * Non-standard transactions (L1<->L2 messages + ArbOS system txs) for an
 * address — powers the "Other Transactions" tab. Same TransactionSummary
 * shape as the main transactions list, so AddressTxTable renders it as-is.
 */
export function getOtherTransactionsByAddress(address: string, limit = 25, offset = 0) {
  return apiFetch<{
    address: string;
    label?: string | null;
    total: number;
    limit: number;
    offset: number;
    transactions: TransactionSummary[];
  }>(`/address/${address}/other-transactions?limit=${limit}&offset=${offset}`, 5);
}

/**
 * One event log emitted by an address (contract), from the indexer's Log
 * table. eventName is a friendly name when topic0 is a known signature; the
 * raw topics + data are always present. Powers the address/contract Events tab.
 */
export interface AddressEventRow {
  txHash: string;
  logIndex: number;
  blockNumber: string;
  timestamp: string;
  address: string;
  topic0: string | null;
  eventName: string | null;
  topics: string[];
  data: string;
  decoded?: {
    name: string;
    signature: string;
    params: { name: string; type: string; indexed: boolean; value: string }[];
  } | null;
}

export function getAddressEvents(address: string, limit = 25, offset = 0) {
  return apiFetch<{
    address: string;
    total: number;
    limit: number;
    offset: number;
    events: AddressEventRow[];
  }>(`/address/${address}/events?limit=${limit}&offset=${offset}`, 5);
}
