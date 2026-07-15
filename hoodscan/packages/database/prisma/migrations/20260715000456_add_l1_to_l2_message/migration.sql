-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "requestId" TEXT;

-- CreateTable
CREATE TABLE "L1ToL2Message" (
    "id" BIGINT NOT NULL,
    "requestId" TEXT NOT NULL,
    "originTxHash" TEXT NOT NULL,
    "originBlockNumber" BIGINT NOT NULL,
    "originTimestamp" TIMESTAMP(3) NOT NULL,
    "originAddress" TEXT NOT NULL,
    "l2TxHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'initiated',

    CONSTRAINT "L1ToL2Message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "L1ToL2Message_requestId_key" ON "L1ToL2Message"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "L1ToL2Message_l2TxHash_key" ON "L1ToL2Message"("l2TxHash");

-- CreateIndex
CREATE INDEX "L1ToL2Message_originBlockNumber_idx" ON "L1ToL2Message"("originBlockNumber");

-- CreateIndex
CREATE INDEX "Transaction_requestId_idx" ON "Transaction"("requestId");

-- AddForeignKey
ALTER TABLE "L1ToL2Message" ADD CONSTRAINT "L1ToL2Message_l2TxHash_fkey" FOREIGN KEY ("l2TxHash") REFERENCES "Transaction"("hash") ON DELETE SET NULL ON UPDATE CASCADE;
