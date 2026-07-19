import type { RawReceipt } from "@hoodscan/types";
import {
  createL2ViemClient,
  createL2EthersProvider,
  createL2JsonRpcSender,
  robinhoodChain,
  describeL2RpcEndpoints,
  L2_RPC_URLS,
} from "@hoodscan/rpc";

export { robinhoodChain, L2_RPC_URLS };

/**
 * Shared viem public client over all configured L2 RPC URLs
 * (round-robin + failover). Read-only — the indexer never signs
 * or sends transactions, it only reads chain state.
 */
export const rpcClient = createL2ViemClient({
  // Public / free-tier RPCs are rate-limited; keep per-URL retries
  // low and let multiHttp fail over to the next endpoint instead.
  retryCount: 1,
  retryDelay: 500,
  timeout: 10_000,
});

/**
 * Ethers multi-provider for the same L2 RPC set. Required by
 * @arbitrum/sdk (ParentTransactionReceipt.getParentToChildMessages),
 * which calls provider.getNetwork() — something viem's PublicClient
 * does not expose.
 */
export const l2EthersProvider = createL2EthersProvider({
  stallTimeout: 1_500,
});

/** Round-robin JsonRpc sender for eth_getBlockReceipts etc. */
const l2RpcSender = createL2JsonRpcSender();

/**
 * Fetch all transaction receipts for a block in a single round-trip
 * (eth_getBlockReceipts). Used to populate gasUsed + effectiveGasPrice
 * for the ACTUAL tx fee, which the block/tx object alone doesn't carry.
 * `blockParam` is a hex block number ("0x...") or a tag ("latest").
 * Returns [] on null.
 */
export async function getBlockReceipts(blockParam: string): Promise<RawReceipt[]> {
  const receipts = await l2RpcSender.send("eth_getBlockReceipts", [blockParam]);
  return (receipts ?? []) as RawReceipt[];
}

export function logL2RpcConfig(): void {
  console.log(
    `[rpc] L2 endpoints (${L2_RPC_URLS.length}): ${describeL2RpcEndpoints()}`
  );
}
