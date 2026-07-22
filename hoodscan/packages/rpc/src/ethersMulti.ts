import { providers } from "ethers";

export type EthersNetworkish = {
  name: string;
  chainId: number;
};

/**
 * Multi-URL ethers provider.
 *
 * - One URL → StaticJsonRpcProvider (fast path, static network avoids
 *   eth_chainId on every call).
 * - Many URLs → FallbackProvider with equal priority/weight so healthy
 *   endpoints share load (ideal for several API keys) and a
 *   dead/slow key is skipped after stallTimeout.
 *
 * Note: FallbackProvider does NOT expose `.send()` for arbitrary JSON-RPC
 * methods. For `eth_getBlockReceipts` etc., use `createMultiJsonRpcSender`.
 */
export function createMultiEthersProvider(
  urls: string[],
  network: EthersNetworkish,
  options?: {
    /** ms before trying the next provider (default 1500). */
    stallTimeout?: number;
  }
): providers.BaseProvider {
  if (urls.length === 0) {
    throw new Error("createMultiEthersProvider: at least one RPC URL is required");
  }

  const stallTimeout = options?.stallTimeout ?? 1_500;

  if (urls.length === 1) {
    return new providers.StaticJsonRpcProvider(urls[0], network);
  }

  const configs: providers.FallbackProviderConfig[] = urls.map((url) => ({
    provider: new providers.StaticJsonRpcProvider(url, network),
    // Equal priority + weight → FallbackProvider load-balances among
    // healthy backends instead of always preferring index 0.
    priority: 1,
    weight: 1,
    stallTimeout,
  }));

  // quorum=1: one successful response is enough (read-only indexer/API).
  return new providers.FallbackProvider(configs, 1);
}

/**
 * Round-robin + failover wrapper around JsonRpcProvider.send().
 * Needed because ethers FallbackProvider has no `.send()` for custom
 * methods like eth_getBlockReceipts.
 */
export function createMultiJsonRpcSender(
  urls: string[],
  network: EthersNetworkish
): {
  send: (method: string, params: Array<unknown>) => Promise<unknown>;
  providers: providers.JsonRpcProvider[];
} {
  if (urls.length === 0) {
    throw new Error("createMultiJsonRpcSender: at least one RPC URL is required");
  }

  const jsonProviders = urls.map(
    (url) => new providers.StaticJsonRpcProvider(url, network)
  );
  let cursor = 0;

  return {
    providers: jsonProviders,
    async send(method: string, params: Array<unknown>) {
      const start = cursor++ % jsonProviders.length;
      let lastError: unknown;

      for (let i = 0; i < jsonProviders.length; i++) {
        const p = jsonProviders[(start + i) % jsonProviders.length]!;
        try {
          return await p.send(method, params);
        } catch (err) {
          lastError = err;
        }
      }

      throw lastError ?? new Error(`multiJsonRpcSend: all endpoints failed for ${method}`);
    },
  };
}
