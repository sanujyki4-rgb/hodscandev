-- CreateTable
CREATE TABLE "Token" (
    "address" TEXT NOT NULL,
    "name" TEXT,
    "symbol" TEXT,
    "decimals" INTEGER,
    "totalSupply" DECIMAL(78,0),
    "tokenType" TEXT NOT NULL,
    "holderCount" INTEGER NOT NULL DEFAULT 0,
    "transferCount" INTEGER NOT NULL DEFAULT 0,
    "firstSeenBlock" BIGINT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "TokenBalance" (
    "id" BIGSERIAL NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "ownerAddress" TEXT NOT NULL,
    "balance" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "updatedBlock" BIGINT NOT NULL,

    CONSTRAINT "TokenBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalTransaction" (
    "id" BIGSERIAL NOT NULL,
    "txHash" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "traceAddress" TEXT NOT NULL,
    "callType" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT,
    "value" DECIMAL(38,0) NOT NULL DEFAULT 0,
    "gas" BIGINT,
    "gasUsed" BIGINT,
    "input" TEXT,
    "output" TEXT,
    "error" TEXT,

    CONSTRAINT "InternalTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Token_tokenType_idx" ON "Token"("tokenType");

-- CreateIndex
CREATE INDEX "Token_symbol_idx" ON "Token"("symbol");

-- CreateIndex
CREATE INDEX "Token_holderCount_idx" ON "Token"("holderCount");

-- CreateIndex
CREATE INDEX "TokenBalance_ownerAddress_idx" ON "TokenBalance"("ownerAddress");

-- CreateIndex
CREATE INDEX "TokenBalance_tokenAddress_balance_idx" ON "TokenBalance"("tokenAddress", "balance");

-- CreateIndex
CREATE UNIQUE INDEX "TokenBalance_tokenAddress_ownerAddress_key" ON "TokenBalance"("tokenAddress", "ownerAddress");

-- CreateIndex
CREATE INDEX "InternalTransaction_txHash_idx" ON "InternalTransaction"("txHash");

-- CreateIndex
CREATE INDEX "InternalTransaction_blockNumber_idx" ON "InternalTransaction"("blockNumber");

-- CreateIndex
CREATE INDEX "InternalTransaction_fromAddress_idx" ON "InternalTransaction"("fromAddress");

-- CreateIndex
CREATE INDEX "InternalTransaction_toAddress_idx" ON "InternalTransaction"("toAddress");

-- CreateIndex
CREATE UNIQUE INDEX "InternalTransaction_txHash_traceAddress_key" ON "InternalTransaction"("txHash", "traceAddress");
