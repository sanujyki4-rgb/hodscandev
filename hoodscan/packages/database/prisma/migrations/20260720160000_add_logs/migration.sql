-- CreateTable
CREATE TABLE "Log" (
    "id" BIGSERIAL NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "address" TEXT NOT NULL,
    "topic0" TEXT,
    "topic1" TEXT,
    "topic2" TEXT,
    "topic3" TEXT,
    "data" TEXT NOT NULL,

    CONSTRAINT "Log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Log_address_idx" ON "Log"("address");

-- CreateIndex
CREATE INDEX "Log_blockNumber_idx" ON "Log"("blockNumber");

-- CreateIndex
CREATE INDEX "Log_topic0_idx" ON "Log"("topic0");

-- CreateIndex
CREATE UNIQUE INDEX "Log_txHash_logIndex_key" ON "Log"("txHash", "logIndex");
