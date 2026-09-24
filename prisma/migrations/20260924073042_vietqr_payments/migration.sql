-- CreateEnum
CREATE TYPE "TopupOrderStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BankTransactionStatus" AS ENUM ('MATCHED', 'UNMATCHED', 'IGNORED');

-- CreateTable
CREATE TABLE "TopupOrder" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "amountVnd" INTEGER NOT NULL,
    "vndPerUsd" INTEGER NOT NULL,
    "status" "TopupOrderStatus" NOT NULL DEFAULT 'PENDING',
    "paidAmountVnd" INTEGER NOT NULL DEFAULT 0,
    "creditMicros" BIGINT NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopupOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amountVnd" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "bankAccount" TEXT,
    "occurredAt" TIMESTAMP(3),
    "status" "BankTransactionStatus" NOT NULL,
    "orderId" TEXT,
    "accountId" TEXT,
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TopupOrder_code_key" ON "TopupOrder"("code");

-- CreateIndex
CREATE INDEX "TopupOrder_accountId_createdAt_idx" ON "TopupOrder"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "BankTransaction_status_createdAt_idx" ON "BankTransaction"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_provider_externalId_key" ON "BankTransaction"("provider", "externalId");

-- AddForeignKey
ALTER TABLE "TopupOrder" ADD CONSTRAINT "TopupOrder_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "RouterAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "TopupOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "RouterAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
