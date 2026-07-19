/**
 * Shared constants for Robinhood Chain across indexer, api, and web.
 * Values verified directly against the public mainnet RPC (chain ID
 * confirmed via docs.robinhood.com/chain and live curl checks).
 */

export const ROBINHOOD_CHAIN_ID = 4663;
export const ROBINHOOD_TESTNET_CHAIN_ID = 46646;

export const RPC_URL_MAINNET =
  process.env.RH_RPC_URL_MAINNET ?? "https://rpc.mainnet.chain.robinhood.com";
export const RPC_URL_TESTNET =
  process.env.RH_RPC_URL_TESTNET ?? "https://rpc.testnet.chain.robinhood.com";

export const BLOCK_EXPLORER_URL = "https://robinhoodchain.blockscout.com";

// --- L1 (Ethereum mainnet) config, used only for indexing L1->L2
// retryable-ticket messages (see L1ToL2Message in the Prisma schema).
// Addresses verified against docs.robinhood.com/chain/protocol-contracts.
export const L1_CHAIN_ID = 1;
export const L1_BRIDGE_ADDRESS = "0xDf8755334ce7A73cCF6b581C02eA649AE3E864b3";
export const L1_DELAYED_INBOX_ADDRESS = "0x1A07cc4BD17E0118BdB54D70990D2158AbAD7a2D";
export const L1_SEQUENCER_INBOX_ADDRESS = "0xBd0D173EEb87D57A09521c24388a12789F33ba96";
export const L1_OUTBOX_ADDRESS = "0xf0ce991ea4A0d2400A4AB49b20ae333f6Dce3DE9";
export const L1_ROLLUP_ADDRESS = "0x23A19d23e89166adedbDcB432518AB01e4272D94";
// No safe public default here (unlike the L2 RPC above) — Ethereum
// mainnet needs a real provider (Alchemy/Infura/etc). Must be set in
// .env for the L1 message watcher job to run.
export const L1_RPC_URL_MAINNET = process.env.L1_RPC_URL_MAINNET ?? "";

// How often the indexer polls for new blocks, in milliseconds.
// Robinhood Chain block time is ~100ms; we poll less aggressively
// than that to avoid hammering the public RPC (rate-limited).
export const INDEXER_POLL_INTERVAL_MS = Number(
  process.env.INDEXER_POLL_INTERVAL_MS ?? 500
);

// Etherscan/Arbiscan cap their global list pages to the most recent
// ~500k records ("Showing the last 500k records"). We mirror that: it
// bounds count(*) and deep-offset costs to at most this many rows.
export const EXPLORER_LIST_CAP = Number(
  process.env.EXPLORER_LIST_CAP ?? 500000
);

// Receipt backfill (jobs/backfillReceipts.ts): blocks scanned per pass
// and pause between blocks. Conservative because the public RPC is
// rate-limited; raise batch / lower delay on your own node.
export const RECEIPT_BACKFILL_BATCH_BLOCKS = Number(
  process.env.RECEIPT_BACKFILL_BATCH_BLOCKS ?? 25
);
export const RECEIPT_BACKFILL_DELAY_MS = Number(
  process.env.RECEIPT_BACKFILL_DELAY_MS ?? 200
);
