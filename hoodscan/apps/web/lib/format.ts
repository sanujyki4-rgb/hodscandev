/**
 * Formatting helpers shared across pages/components. Kept separate
 * from lib/api.ts so display logic doesn't leak into data-fetching code.
 */

import { TX_TYPE_LABELS, getMethodLabel, getAddressLabel } from "@hoodscan/types";
import type { BlockSummary } from "./api";

export function shortenHash(hash: string, chars = 6): string {
  if (hash.length <= chars * 2 + 2) return hash;
  return `${hash.slice(0, chars + 2)}…${hash.slice(-chars)}`;
}

/**
 * Fixed-width truncation used by the token/NFT transfer and holders
 * tables (shorter and less symmetric than shortenHash() above, to
 * match those tables' narrower columns).
 */
export function shortTxHash(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash;
}

export function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 8)}…${addr.slice(-4)}` : addr;
}

/**
 * Trim an already thousands-separated token amount (e.g.
 * "305,545.694355304349942012") down to a readable number of decimals
 * — like Etherscan/Arbiscan, which don't show the full 18-decimal
 * tail. The integer part is preserved; the fraction is capped at
 * `maxFrac` significant digits with trailing zeros trimmed. Pair this
 * with the raw `formatted` value in a title tooltip so full precision
 * is still one hover away.
 */
export function shortTokenAmount(
  formatted: string | null,
  rawAmount: string,
  maxFrac = 4
): string {
  if (!formatted) return `${rawAmount} (raw)`;
  const [intPart, fracPart] = formatted.split(".");
  if (!fracPart) return intPart ?? formatted;
  const trimmed = fracPart.slice(0, maxFrac).replace(/0+$/, "");
  return trimmed ? `${intPart}.${trimmed}` : (intPart ?? "0");
}

/** Format a supply-share percentage the way explorers do (e.g. "12.3456%"). */
export function formatPercent(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return "—";
  if (pct > 0 && pct < 0.0001) return "<0.0001%";
  return `${pct.toLocaleString(undefined, { maximumFractionDigits: 4 })}%`;
}

/**
 * Display an address using its curated friendly label when one is
 * provided, otherwise the shortened hash. Etherscan/Arbiscan style.
 */
export function displayAddress(address: string, label?: string | null): string {
  return label ?? shortenHash(address);
}

/** Same as displayAddress() but using shortAddr()'s (shorter) truncation. */
export function displayAddr(address: string, label?: string | null): string {
  return label ?? shortAddr(address);
}

export { getAddressLabel };

export function weiToEth(wei: string, decimals = 6): string {
  const value = BigInt(wei);
  const eth = Number(value) / 1e18;
  return eth.toFixed(decimals);
}

/**
 * Shared core for txnFeeEth/approxTxnFeeEth — both are "multiply two
 * wei-denominated strings, express the product in ETH, round
 * sensibly". Only the two inputs' meaning differs (actual vs. max),
 * so that's the only thing each public function still owns.
 */
function weiPairToEth(a: string, b: string, decimals: number): string {
  const feeWei = BigInt(a) * BigInt(b);
  const eth = Number(feeWei) / 1e18;
  if (eth === 0) return "0";
  if (eth < 1e-8) return eth.toExponential(2);
  return eth.toFixed(decimals).replace(/\.?0+$/, "");
}

/**
 * Approximate txn fee in ETH from stored fields.
 * True fee is gasUsed × effectiveGasPrice; we only index gas (limit) + gasPrice/maxFee,
 * so this is gas × gasPrice (or maxFeePerGas) when available.
 */
export function approxTxnFeeEth(
  gas: string | undefined,
  gasPrice: string | null | undefined,
  maxFeePerGas?: string | null,
  decimals = 8
): string | null {
  if (!gas) return null;
  const price = gasPrice && gasPrice !== "0" ? gasPrice : maxFeePerGas;
  if (!price || price === "0") return null;
  try {
    return weiPairToEth(gas, price, decimals);
  } catch {
    return null;
  }
}

/**
 * ACTUAL txn fee in ETH = gasUsed × effectiveGasPrice, both from the
 * transaction receipt (eth_getBlockReceipts). This is the real amount
 * charged (Etherscan's "Txn Fee"), not the max the sender allowed.
 * Returns null when receipt data hasn't been indexed for this row yet
 * — callers fall back to approxTxnFeeEth().
 */
export function txnFeeEth(
  gasUsed: string | null | undefined,
  effectiveGasPrice: string | null | undefined,
  decimals = 8
): string | null {
  if (!gasUsed || !effectiveGasPrice) return null;
  try {
    return weiPairToEth(gasUsed, effectiveGasPrice, decimals);
  } catch {
    return null;
  }
}

/**
 * Resolves the Txn Fee column in one call: prefers the ACTUAL fee
 * (gasUsed × effectiveGasPrice) when the receipt has been indexed,
 * falling back to the max-fee approximation otherwise. Also reports
 * which one it used, so callers (TxTable, AddressTxTable) can show
 * the right tooltip without recomputing txnFeeEth() a second time
 * just to check.
 */
export function resolvedTxnFee(tx: {
  gasUsed?: string | null;
  effectiveGasPrice?: string | null;
  gas?: string;
  gasPrice?: string | null;
  maxFeePerGas?: string | null;
}): { value: string | null; isActual: boolean } {
  const actual = txnFeeEth(tx.gasUsed, tx.effectiveGasPrice);
  if (actual !== null) return { value: actual, isActual: true };
  return {
    value: approxTxnFeeEth(tx.gas, tx.gasPrice, tx.maxFeePerGas),
    isActual: false,
  };
}

export const TXN_FEE_TOOLTIP = {
  actual: "Actual fee charged: gas used × effective gas price",
  approx: "Approximate (gas limit × max fee per gas) — receipt not yet backfilled for this tx",
};

export function timeAgo(isoTimestamp: string): string {
  const seconds = Math.floor((Date.now() - new Date(isoTimestamp).getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function txTypeLabel(type: string): string {
  return TX_TYPE_LABELS[type] ?? type;
}

/**
 * Default Method column label (no curated selector map).
 * - System / L1↔L2 by tx type
 * - Empty calldata → Transfer
 * - Otherwise raw 4-byte selector (0x…)
 */
export function methodLabel(
  selector: string | null | undefined,
  txType?: string | null,
  _valueWei?: string | null
): string {
  // Delegates to the shared curated selector -> method map in @hoodscan/types
  // so the Method column shows friendly names (Approve, Swap, Deposit, ...).
  return getMethodLabel(selector, txType);
}

/**
 * Average time between blocks, in milliseconds, measured across the
 * given (newest-first) block list. Returns 0 if there isn't enough
 * data to measure a span — callers decide how to display that (e.g.
 * fall back to "—").
 */
export function avgBlockTimeMs(blocks: BlockSummary[]): number {
  if (blocks.length < 2) return 0;
  const newest = new Date(blocks[0].timestamp).getTime();
  const oldest = new Date(blocks[blocks.length - 1].timestamp).getTime();
  return ((newest - oldest) / 1000 / (blocks.length - 1)) * 1000;
}

/**
 * Gas used, formatted like an explorer's block list/detail view:
 * "18,234,567 (61%)" — comma-separated with the % of gasLimit
 * consumed. Shared by BlocksTable and the block detail page so the
 * two can't drift apart.
 */
export function formatGasUsed(used: string, limit: string): string {
  const usedNum = Number(used);
  const limitNum = Number(limit);
  const pct = limitNum > 0 ? (usedNum / limitNum) * 100 : 0;
  const pctLabel =
    pct > 0 && pct < 0.5 ? "<1%" : pct < 10 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`;
  const pctDisplay = pct < 0.5 ? "0%" : pctLabel;
  return `${usedNum.toLocaleString("en-US")} (${pctDisplay})`;
}

/** Gas limit, comma-separated. */
export function formatGasLimit(limit: string): string {
  return Number(limit).toLocaleString("en-US");
}

/** Wei -> gwei, the conventional unit for displaying base fee / gas price. */
export function formatGwei(wei: string, decimals = 3): string {
  return `${(Number(wei) / 1e9).toFixed(decimals)} gwei`;
}
