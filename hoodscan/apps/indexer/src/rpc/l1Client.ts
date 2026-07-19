import { registerCustomArbitrumNetwork } from "@arbitrum/sdk";
import {
  L1_BRIDGE_ADDRESS,
  L1_DELAYED_INBOX_ADDRESS,
  L1_SEQUENCER_INBOX_ADDRESS,
  L1_OUTBOX_ADDRESS,
  L1_ROLLUP_ADDRESS,
  ROBINHOOD_CHAIN_ID,
} from "@hoodscan/config";
import {
  createL1EthersProvider,
  describeL1RpcEndpoints,
  L1_RPC_URLS,
} from "@hoodscan/rpc";

/**
 * @arbitrum/sdk is built on ethers (v5), not viem — separate provider
 * from the main viem `rpcClient` used for Robinhood Chain itself.
 * This one talks to Ethereum L1 (multi-URL: Alchemy keys + others)
 * and is only used by the L1->L2 message watcher job.
 * Null when no L1 RPC is configured.
 */
export const l1Provider = createL1EthersProvider({ stallTimeout: 2_500 });

let registered = false;

/**
 * Registers Robinhood Chain with the Arbitrum SDK so
 * `getL1ToL2Messages()` etc. know which L1 contracts to check.
 * Addresses verified against docs.robinhood.com/chain/protocol-contracts
 * — must be called once before any other @arbitrum/sdk usage. Safe to
 * call more than once; only the first call takes effect.
 */
export function registerRobinhoodChainWithSdk() {
  if (registered) return;

  registerCustomArbitrumNetwork({
    chainId: ROBINHOOD_CHAIN_ID,
    parentChainId: 1, // Ethereum mainnet
    confirmPeriodBlocks: 45818,
    isCustom: true,
    isTestnet: false,
    name: "Robinhood Chain",
    ethBridge: {
      bridge: L1_BRIDGE_ADDRESS,
      inbox: L1_DELAYED_INBOX_ADDRESS,
      sequencerInbox: L1_SEQUENCER_INBOX_ADDRESS,
      outbox: L1_OUTBOX_ADDRESS,
      rollup: L1_ROLLUP_ADDRESS,
    },
  } as Parameters<typeof registerCustomArbitrumNetwork>[0]);

  registered = true;
}

export function logL1RpcConfig(): void {
  console.log(
    `[rpc] L1 endpoints (${L1_RPC_URLS.length}): ${describeL1RpcEndpoints()}`
  );
}
