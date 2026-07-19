import { createPublicClient, defineChain, type PublicClient, type Transport } from "viem";
import { providers } from "ethers";
import {
  L2_RPC_URLS,
  ROBINHOOD_CHAIN_ID,
  RPC_URL_MAINNET,
  redactRpcUrl,
} from "@hoodscan/config";
import { multiHttp } from "./multiHttp";
import {
  createMultiEthersProvider,
  createMultiJsonRpcSender,
} from "./ethersMulti";

/**
 * Robinhood Chain mainnet definition for viem.
 * EVM-compatible L2 built on Arbitrum Orbit — standard eth_* JSON-RPC
 * methods apply, including block tags "latest" and "finalized".
 */
export const robinhoodChain = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [...L2_RPC_URLS] },
  },
});

export type L2ViemClientOptions = {
  /** Per-URL http timeout ms (default 10_000). */
  timeout?: number;
  /** Retries on a single URL before failing over (default 0). */
  retryCount?: number;
  retryDelay?: number;
};

/**
 * Read-only viem public client over all configured L2 RPC URLs
 * (round-robin + failover via multiHttp).
 */
export function createL2ViemClient(
  options: L2ViemClientOptions = {}
): PublicClient {
  const transport = multiHttp(L2_RPC_URLS, {
    timeout: options.timeout ?? 10_000,
    retryCount: options.retryCount ?? 0,
    retryDelay: options.retryDelay ?? 500,
  }) as Transport;

  return createPublicClient({
    chain: robinhoodChain,
    transport,
  });
}

const L2_NETWORK = {
  name: "Robinhood Chain",
  chainId: ROBINHOOD_CHAIN_ID,
} as const;

/**
 * Ethers multi-provider for the same L2 RPC set. Required by
 * @arbitrum/sdk (Provider interface — getNetwork, getTransaction, …).
 */
export function createL2EthersProvider(options?: {
  stallTimeout?: number;
}): providers.BaseProvider {
  return createMultiEthersProvider(L2_RPC_URLS, L2_NETWORK, options);
}

/**
 * JsonRpc `.send()` with round-robin + failover across all L2 URLs.
 * Use for methods FallbackProvider cannot call (e.g. eth_getBlockReceipts).
 */
export function createL2JsonRpcSender() {
  return createMultiJsonRpcSender(L2_RPC_URLS, L2_NETWORK);
}

/** Human-readable summary for startup logs (API keys redacted). */
export function describeL2RpcEndpoints(): string {
  return L2_RPC_URLS.map((u, i) => `#${i + 1} ${redactRpcUrl(u)}`).join(", ");
}

export { L2_RPC_URLS, RPC_URL_MAINNET, ROBINHOOD_CHAIN_ID };
