import { createPublicClient, http, defineChain } from "viem";
import { providers } from "ethers";
import { RPC_URL_MAINNET, ROBINHOOD_CHAIN_ID } from "@hoodscan/config";

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
    default: { http: [RPC_URL_MAINNET] },
  },
});

/**
 * Shared viem public client. Read-only — the indexer never signs
 * or sends transactions, it only reads chain state.
 */
export const rpcClient = createPublicClient({
  chain: robinhoodChain,
  transport: http(RPC_URL_MAINNET, {
    // Public RPC is rate-limited; keep retries conservative so a
    // slow response doesn't cascade into a request storm.
    retryCount: 2,
    retryDelay: 500,
    timeout: 10_000,
  }),
});

/**
 * Ethers v5 provider for the same L2 RPC. Required by @arbitrum/sdk
 * (ParentTransactionReceipt.getParentToChildMessages), which calls
 * provider.getNetwork() — something viem's PublicClient does not expose.
 * Static network avoids an extra eth_chainId on every SDK call.
 */
export const l2EthersProvider = new providers.JsonRpcProvider(
  RPC_URL_MAINNET,
  {
    name: "Robinhood Chain",
    chainId: ROBINHOOD_CHAIN_ID,
  }
);
