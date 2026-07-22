-- Partial indexes to accelerate GET /address/:address/other-transactions.
-- "Other" transactions are the rare non-standard txTypes (L1<->L2 messages
-- 0x69, ArbOS system 0x6a, etc.). Because standard txs (0x0/0x1/0x2) dominate,
-- a partial index that stores ONLY the non-standard rows keeps both the fetch
-- and the count as tiny index scans instead of scanning an address's entire
-- transaction history.
-- NOTE: plain (non-CONCURRENTLY) CREATE INDEX so it applies cleanly via the
-- standard `prisma migrate dev` flow (the shadow DB cannot run CONCURRENTLY
-- inside a transaction). Building takes a brief write lock on Transaction,
-- which is fine for dev. For a zero-downtime PRODUCTION build, apply a
-- CONCURRENTLY variant manually via `prisma migrate deploy` / psql instead.
-- Idempotent (IF NOT EXISTS).
CREATE INDEX IF NOT EXISTS "tx_other_from_idx"
  ON "Transaction" ("fromAddress", "blockNumber" DESC, "transactionIndex" DESC)
  WHERE "txType" NOT IN ('0x0', '0x1', '0x2');

CREATE INDEX IF NOT EXISTS "tx_other_to_idx"
  ON "Transaction" ("toAddress", "blockNumber" DESC, "transactionIndex" DESC)
  WHERE "txType" NOT IN ('0x0', '0x1', '0x2');
