import type { RawReceipt } from "@hoodscan/types";
import {
  createL2EthersProvider,
  robinhoodChain,
  sendRpc,
  describeProviders,
  L2_RPC_URLS,
} from "@hoodscan/rpc";

export { robinhoodChain, L2_RPC_URLS };

/**
 * Capability-aware JSON-RPC client for ALL L2 reads.
 *
 * Every call is routed through the multi-provider router (`sendRpc`), which
 * picks providers by capability ("role") with per-provider retry + backoff
 * and automatic failover:
 *   bulk (block / receipts / logs)  → ZAN → Uniblock → QuickNode
 *   debug_trace*                    → Uniblock → QuickNode  (never ZAN)
 *   everything else                 → Uniblock → ZAN → QuickNode
 *
 * The object intentionally exposes the same `.request({ method, params })`
 * shape the indexer jobs already used (a subset of viem's PublicClient), so
 * poll/backfill jobs need no changes — they now transparently use the router.
 */
export const rpcClient = {
  request: <T = unknown>({
    method,
    params,
  }: {
    method: string;
    params?: unknown[];
  }): Promise<T> => sendRpc<T>(method, (params ?? []) as unknown[]),
};

/**
 * Ethers multi-provider for the L2 RPC set. Required by @arbitrum/sdk
 * (ParentTransactionReceipt.getParentToChildMessages), which calls
 * provider.getNetwork() — something the fetch-based router does not expose.
 * Runs over the header-free L2_RPC_URLS (ZAN / QuickNode / public default);
 * Uniblock is excluded there because it needs an X-API-KEY header.
 */
export const l2EthersProvider = createL2EthersProvider({
  stallTimeout: 1_500,
});

/**
 * Fetch all transaction receipts for a block in a single round-trip
 * (eth_getBlockReceipts) via the BULK role (ZAN). Used to populate
 * gasUsed + effectiveGasPrice for the ACTUAL tx fee, which the block/tx
 * object alone doesn't carry. `blockParam` is a hex block number ("0x...")
 * or a tag ("latest"). Returns [] on null.
 */
export async function getBlockReceipts(blockParam: string): Promise<RawReceipt[]> {
  const receipts = await sendRpc<RawReceipt[] | null>("eth_getBlockReceipts", [
    blockParam,
  ]);
  return receipts ?? [];
}

export function logL2RpcConfig(): void {
  console.log(`[rpc] Capability providers: ${describeProviders()}`);
}
