-- CreateTable
CREATE TABLE "VerifiedContract" (
    "address" TEXT NOT NULL,
    "contractName" TEXT NOT NULL,
    "compilerVersion" TEXT NOT NULL,
    "optimizationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "optimizationRuns" INTEGER NOT NULL DEFAULT 200,
    "evmVersion" TEXT,
    "sourceCode" TEXT NOT NULL,
    "abi" TEXT NOT NULL,
    "constructorArguments" TEXT,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerifiedContract_pkey" PRIMARY KEY ("address")
);
