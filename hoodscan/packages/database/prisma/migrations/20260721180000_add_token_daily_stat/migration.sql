-- Pre-aggregated per-day token analytics rollup. Populated in bulk by the
-- `backfill:token-daily` job and maintained incrementally by the indexer
-- (tokenTransferService.saveTokenTransfers). Lets GET /tokens/:address/daily
-- read an O(days) primary-key slice instead of running COUNT(DISTINCT) over
-- millions of TokenTransfer rows.
CREATE TABLE "TokenDailyStat" (
    "tokenAddress" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "transfers" INTEGER NOT NULL,
    "senders" INTEGER NOT NULL,
    "receivers" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TokenDailyStat_pkey" PRIMARY KEY ("tokenAddress","day")
);
