import type { RawBlock, DecodedBlock, RawTransaction, DecodedTransaction, RawReceipt } from "@hoodscan/types";

/**
 * Convert a hex string ("0x66d56b") to a bigint.
 * Returns 0n for null/undefined input.
 */
export function hexToBigInt(hex: string | null | undefined): bigint {
  if (!hex) return 0n;
  return BigInt(hex);
}

/**
 * Convert a hex string to a regular JS number.
 * Only safe for values that fit in Number.MAX_SAFE_INTEGER
 * (block number, size, tx index, tx count — never use for value/wei).
 */
export function hexToNumber(hex: string | null | undefined): number {
  if (!hex) return 0;
  return Number(BigInt(hex));
}

/**
 * Convert a hex unix timestamp ("0x6a51e67c") to a JS Date.
 */
export function hexToDate(hex: string): Date {
  return new Date(hexToNumber(hex) * 1000);
}

/**
 * Extract the 4-byte function selector from transaction input data.
 * Returns null for plain ETH transfers (input === "0x") or system
 * transactions with empty/trivial input.
 */
export function extractFunctionSelector(input: string): string | null {
  if (!input || input === "0x" || input.length < 10) return null;
  return input.slice(0, 10); // "0x" + 8 hex chars = 4 bytes
}

/**
 * Decode a raw RPC block into the shape persisted to the database.
 * Does NOT decode transactions — call decodeTransaction() per tx
 * separately, since blocks may be fetched with hash-only tx lists.
 */
export function decodeBlock(raw: RawBlock): DecodedBlock {
  const txCount = raw.transactions.length;

  return {
    number: hexToBigInt(raw.number),
    hash: raw.hash,
    parentHash: raw.parentHash,
    timestamp: hexToDate(raw.timestamp),
    gasUsed: hexToBigInt(raw.gasUsed),
    gasLimit: hexToBigInt(raw.gasLimit),
    baseFeePerGas: hexToBigInt(raw.baseFeePerGas),
    l1BlockNumber: hexToBigInt(raw.l1BlockNumber),
    sendCount: hexToBigInt(raw.sendCount),
    sendRoot: raw.sendRoot,
    size: hexToNumber(raw.size),
    txCount,
  };
}

/**
 * Decode a single raw transaction (as returned when a block is
 * fetched with the "full transactions" flag) into the shape
 * persisted to the database.
 */
export function decodeTransaction(
  raw: RawTransaction,
  receipt?: RawReceipt
): DecodedTransaction {
  return {
    hash: raw.hash,
    blockNumber: hexToBigInt(raw.blockNumber),
    transactionIndex: hexToNumber(raw.transactionIndex),
    fromAddress: raw.from,
    toAddress: raw.to,
    nonce: hexToBigInt(raw.nonce),
    value: hexToBigInt(raw.value).toString(),
    gas: hexToBigInt(raw.gas),
    gasPrice: raw.gasPrice ? hexToBigInt(raw.gasPrice).toString() : null,
    maxFeePerGas: raw.maxFeePerGas ? hexToBigInt(raw.maxFeePerGas).toString() : null,
    maxPriorityFeePerGas: raw.maxPriorityFeePerGas
      ? hexToBigInt(raw.maxPriorityFeePerGas).toString()
      : null,
    input: raw.input,
    functionSelector: extractFunctionSelector(raw.input),
    txType: raw.type,
    requestId: raw.requestId ?? null,
    // Receipt-derived actual-fee fields. gasUsed is stored even when 0
    // so a backfilled row is never left null; effectiveGasPrice stays
    // null if the receipt didn't include it.
    gasUsed: receipt?.gasUsed != null ? hexToBigInt(receipt.gasUsed) : null,
    effectiveGasPrice: receipt?.effectiveGasPrice
      ? hexToBigInt(receipt.effectiveGasPrice).toString()
      : null,
  };
}
