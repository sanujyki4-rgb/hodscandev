/**
 * Formatting helpers shared across pages/components. Kept separate
 * from lib/api.ts so display logic doesn't leak into data-fetching code.
 */

import type { BlockSummary } from "./api";

export function shortenHash(hash: string, chars = 6): string {
  if (hash.length <= chars * 2 + 2) return hash;
  return `${hash.slice(0, chars + 2)}…${hash.slice(-chars)}`;
}

export function weiToEth(wei: string, decimals = 6): string {
  const value = BigInt(wei);
  const eth = Number(value) / 1e18;
  return eth.toFixed(decimals);
}

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
  const labels: Record<string, string> = {
    "0x0": "Legacy",
    "0x2": "EIP-1559",
    "0x69": "L1↔L2 Message",
    "0x6a": "System",
  };
  return labels[type] ?? type;
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
