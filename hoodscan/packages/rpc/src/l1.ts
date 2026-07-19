import { providers } from "ethers";
import {
  L1_CHAIN_ID,
  L1_RPC_URLS,
  L1_RPC_URL_MAINNET,
  redactRpcUrl,
} from "@hoodscan/config";
import { createMultiEthersProvider } from "./ethersMulti";

/**
 * Multi-URL ethers provider for Ethereum L1, or null when no L1 RPC
 * is configured (L1→L2 watcher no-ops in that case).
 */
export function createL1EthersProvider(options?: {
  stallTimeout?: number;
}): providers.BaseProvider | null {
  if (L1_RPC_URLS.length === 0) return null;

  return createMultiEthersProvider(
    L1_RPC_URLS,
    {
      name: "homestead",
      chainId: L1_CHAIN_ID,
    },
    // L1 eth_getLogs can be slow; give each key a bit longer before stall.
    { stallTimeout: options?.stallTimeout ?? 2_500 }
  );
}

/** Human-readable summary for startup logs (API keys redacted). */
export function describeL1RpcEndpoints(): string {
  if (L1_RPC_URLS.length === 0) return "(none — L1 watcher disabled)";
  return L1_RPC_URLS.map((u, i) => `#${i + 1} ${redactRpcUrl(u)}`).join(", ");
}

export { L1_RPC_URLS, L1_RPC_URL_MAINNET, L1_CHAIN_ID };
