-- Composite indexes to accelerate token-transfer list + analytics endpoints.
-- Each serves a WHERE + ORDER BY (blockNumber DESC, logIndex DESC) as an index
-- scan instead of sorting hundreds of thousands of rows.
CREATE INDEX "tt_token_block_log_idx" ON "TokenTransfer"("tokenAddress", "blockNumber", "logIndex");
CREATE INDEX "tt_from_block_log_idx" ON "TokenTransfer"("fromAddress", "blockNumber", "logIndex");
CREATE INDEX "tt_to_block_log_idx" ON "TokenTransfer"("toAddress", "blockNumber", "logIndex");
-- Narrows the per-day analytics window (tokenAddress + timestamp range).
CREATE INDEX "tt_token_ts_idx" ON "TokenTransfer"("tokenAddress", "timestamp");
