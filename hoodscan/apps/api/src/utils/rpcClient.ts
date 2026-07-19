/**
 * Shared L2 viem client for API on-chain reads (token metadata,
 * isContract, ERC-165 probes, read-contract).
 *
 * Uses every URL from L2_RPC_URLS (RH_RPC_URLS / Alchemy keys / etc.)
 * with round-robin + failover via @hoodscan/rpc.
 */
import { createL2ViemClient, robinhoodChain, L2_RPC_URLS } from "@hoodscan/rpc";

export { robinhoodChain, L2_RPC_URLS };

/**
 * Conservative timeouts so a slow RPC can't cascade into a request
 * storm on detail endpoints. Failover to the next URL is preferred
 * over hammering a single Alchemy key with retries.
 */
export const rpcClient = createL2ViemClient({
  retryCount: 0,
  retryDelay: 300,
  timeout: 3_000,
});

/** Alias used by read-contract controllers. */
export const readRpcClient = rpcClient;
