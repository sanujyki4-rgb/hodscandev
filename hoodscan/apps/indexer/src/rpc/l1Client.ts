import { providers } from "ethers";
import { registerCustomArbitrumNetwork } from "@arbitrum/sdk";
import {
  L1_RPC_URL_MAINNET,
  L1_BRIDGE_ADDRESS,
  L1_DELAYED_INBOX_ADDRESS,
  L1_SEQUENCER_INBOX_ADDRESS,
  L1_OUTBOX_ADDRESS,
  L1_ROLLUP_ADDRESS,
  ROBINHOOD_CHAIN_ID,
} from "@hoodscan/config";

/**
 * @arbitrum/sdk is built on ethers (v5), not viem — separate provider
 * from the main viem `rpcClient` used for Robinhood Chain itself.
 * This one talks to Ethereum L1 and is only used by the L1->L2
 * message watcher job (see jobs/watchL1Messages.ts).
 */
export const l1Provider = L1_RPC_URL_MAINNET
  ? new providers.JsonRpcProvider(L1_RPC_URL_MAINNET)
  : null;

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
