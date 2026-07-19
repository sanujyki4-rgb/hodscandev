-- CreateTable
CREATE TABLE "TokenTransfer" (
    "id" BIGSERIAL NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "amount" DECIMAL(78,0) NOT NULL,

    CONSTRAINT "TokenTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TokenTransfer_tokenAddress_idx" ON "TokenTransfer"("tokenAddress");

-- CreateIndex
CREATE INDEX "TokenTransfer_fromAddress_idx" ON "TokenTransfer"("fromAddress");

-- CreateIndex
CREATE INDEX "TokenTransfer_toAddress_idx" ON "TokenTransfer"("toAddress");

-- CreateIndex
CREATE INDEX "TokenTransfer_blockNumber_idx" ON "TokenTransfer"("blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TokenTransfer_txHash_logIndex_key" ON "TokenTransfer"("txHash", "logIndex");
