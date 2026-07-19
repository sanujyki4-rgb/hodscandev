-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "effectiveGasPrice" DECIMAL(38,0),
ADD COLUMN     "gasUsed" BIGINT;

-- CreateIndex
CREATE INDEX "Transaction_blockNumber_transactionIndex_idx" ON "Transaction"("blockNumber", "transactionIndex");
