import { Contract } from "ethers";
// @arbitrum/sdk v4 renamed L1* → Parent* (parent chain = Ethereum L1).
import { ParentTransactionReceipt } from "@arbitrum/sdk";
import { l1Provider, registerRobinhoodChainWithSdk } from "../rpc/l1Client";
import { l2EthersProvider } from "../rpc/client";
import { L1_BRIDGE_ADDRESS } from "@hoodscan/config";
import {
  saveL1Message,
  getLatestIndexedL1BlockNumber,
  reconcileInitiatedL1Messages,
} from "../services/l1MessageService";

// Minimal ABI — we only need the MessageDelivered event to discover
// new L1->L2 messages. Signature verified against nitro-contracts
// (OffchainLabs/nitro-contracts, src/bridge/IBridge.sol).
const BRIDGE_ABI = [
  "event MessageDelivered(uint256 indexed messageIndex, bytes32 indexed beforeInboxAcc, address inbox, uint8 kind, address sender, bytes32 messageDataHash, uint256 baseFeeL1, uint64 timestamp)",
];

// How many L1 blocks to scan per eth_getLogs call.
// Alchemy Free tier allows at most a 10-block range for eth_getLogs
// (PAYG/higher tiers allow more). Stay at 10 so Free L1 keys work.
const LOG_BATCH_SIZE = 10n;

/**
 * Highest L1 block fully scanned in this process. Needed because progress
 * cannot rely only on max(L1ToL2Message.originBlockNumber): many
 * MessageDelivered events are not parent→child retryables, so nothing is
 * written to the DB and the same range would be re-scanned forever.
 * This is process memory only (not a DB watermark table).
 */
let lastScannedL1Block: bigint | null = null;

/**
 * Watches the Bridge contract on Ethereum L1 for MessageDelivered
 * events and records each one as a candidate L1->L2 message. Does
 * NOT try to compute requestId by hand — instead, for each delivered
 * message, it asks @arbitrum/sdk (via ParentTransactionReceipt.getParentToChildMessages)
 * to compute the message's request ID from the real L1 transaction data,
 * the same logic Offchain Labs' own SDK uses. This avoids re-implementing
 * an undocumented hash formula ourselves.
 *
 * @param options.fromBlock - L1 block to start scanning from. If
 *   omitted, resumes from the last block we've indexed, or — on a
 *   fresh database — starts from the CURRENT L1 head (only messages
 *   from here forward get tracked). Historical backfill (e.g. back to
 *   Robinhood Chain's mainnet launch on L1) is a deliberate later step
 *   for hoodscan-indexer, not something this job does automatically;
 *   pass an explicit fromBlock when that's actually wanted.
 * @param options.toBlock - L1 block to stop at (defaults to current L1 head).
 */
export async function watchL1Messages(options?: {
  fromBlock?: bigint;
  toBlock?: bigint;
}): Promise<void> {
  if (!l1Provider) {
    console.warn(
      "[watchL1Messages] No L1 RPC configured — skipping. " +
        "Set L1_RPC_URLS, L1_RPC_URL_MAINNET, and/or ALCHEMY_L1_API_KEYS " +
        "in .env to enable L1->L2 message tracking."
    );
    return;
  }

  registerRobinhoodChainWithSdk();

  const bridge = new Contract(L1_BRIDGE_ADDRESS, BRIDGE_ABI, l1Provider);

  const l1Head = BigInt(await l1Provider.getBlockNumber());
  const toBlock = options?.toBlock ?? l1Head;

  let fromBlock = options?.fromBlock;
  if (fromBlock === undefined) {
    const lastIndexed = await getLatestIndexedL1BlockNumber();
    const fromDb = lastIndexed !== null ? lastIndexed + 1n : null;
    const fromScan = lastScannedL1Block !== null ? lastScannedL1Block + 1n : null;

    if (fromDb !== null || fromScan !== null) {
      // Resume from whichever is further ahead so we don't re-scan ranges
      // that produced Bridge events but no parent→child retryable tickets.
      fromBlock =
        fromDb !== null && fromScan !== null
          ? fromDb > fromScan
            ? fromDb
            : fromScan
          : (fromDb ?? fromScan)!;
    } else {
      // Fresh database, no fromBlock given: start from the current L1
      // head rather than sitting idle forever. This intentionally does
      // NOT backfill older messages — see the doc comment above.
      fromBlock = l1Head;
      console.log(
        `[watchL1Messages] No L1 messages indexed yet — starting from current L1 head (block ${l1Head}). ` +
          "Pass options.fromBlock explicitly to backfill older messages instead."
      );
    }
  }

  if (fromBlock > toBlock) return; // already caught up

  for (let start = fromBlock; start <= toBlock; start += LOG_BATCH_SIZE) {
    const end = start + LOG_BATCH_SIZE - 1n > toBlock ? toBlock : start + LOG_BATCH_SIZE - 1n;

    const events = await bridge.queryFilter(bridge.filters.MessageDelivered(), Number(start), Number(end));

    let saved = 0;
    for (const event of events) {
      const receipt = await event.getTransactionReceipt();
      const parentReceipt = new ParentTransactionReceipt(receipt);

      // SDK requires an ethers Provider (getNetwork), not viem PublicClient.
      // Robinhood network is registered via registerRobinhoodChainWithSdk().
      const l2Messages = await parentReceipt.getParentToChildMessages(l2EthersProvider);

      for (const l2Message of l2Messages) {
        await saveL1Message({
          id: BigInt((event.args as unknown as { messageIndex: bigint }).messageIndex),
          requestId: l2Message.retryableCreationId,
          originTxHash: receipt.transactionHash,
          originBlockNumber: BigInt(receipt.blockNumber),
          originTimestamp: new Date((await event.getBlock()).timestamp * 1000),
          originAddress: (event.args as unknown as { sender: string }).sender,
        });
        saved++;
      }
    }

    // Advance in-process scan cursor even when Bridge events were not
    // parent→child retryables (so the next tick does not restart here).
    lastScannedL1Block = end;

    console.log(
      `[watchL1Messages] Scanned L1 blocks ${start}-${end}, ` +
        `bridgeEvents=${events.length}, parentToChildSaved=${saved}.`
    );
  }

  // Retry linking any still-initiated messages (L2 ticket may have landed
  // after the L1 event was first saved, or been missed by L2 poll holes).
  const linked = await reconcileInitiatedL1Messages();
  if (linked > 0) {
    console.log(`[watchL1Messages] Linked ${linked} L1 message(s) to L2 ticket txs.`);
  }
}
