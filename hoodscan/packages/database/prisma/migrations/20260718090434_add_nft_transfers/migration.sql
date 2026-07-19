-- CreateTable
CREATE TABLE "NftTransfer" (
    "id" BIGSERIAL NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "batchIndex" INTEGER NOT NULL DEFAULT 0,
    "blockNumber" BIGINT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "amount" TEXT NOT NULL DEFAULT '1',
    "standard" TEXT NOT NULL,

    CONSTRAINT "NftTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexerCursor" (
    "name" TEXT NOT NULL,
    "value" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexerCursor_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "NftTransfer_tokenAddress_idx" ON "NftTransfer"("tokenAddress");

-- CreateIndex
CREATE INDEX "NftTransfer_fromAddress_idx" ON "NftTransfer"("fromAddress");

-- CreateIndex
CREATE INDEX "NftTransfer_toAddress_idx" ON "NftTransfer"("toAddress");

-- CreateIndex
CREATE INDEX "NftTransfer_blockNumber_idx" ON "NftTransfer"("blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "NftTransfer_txHash_logIndex_batchIndex_key" ON "NftTransfer"("txHash", "logIndex", "batchIndex");
