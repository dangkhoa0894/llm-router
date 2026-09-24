-- CreateEnum
CREATE TYPE "RouterAccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "RouterModelType" AS ENUM ('CHAT', 'EMBEDDING');

-- CreateEnum
CREATE TYPE "RouterRoutingStrategy" AS ENUM ('PRIORITY', 'LOWEST_COST', 'WEIGHTED');

-- CreateEnum
CREATE TYPE "CreditTransactionType" AS ENUM ('TOPUP', 'USAGE', 'REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "RouterRequestStatus" AS ENUM ('SUCCESS', 'ERROR');

-- CreateTable
CREATE TABLE "RouterAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "RouterAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "balanceMicros" BIGINT NOT NULL DEFAULT 0,
    "rpmLimit" INTEGER NOT NULL DEFAULT 60,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouterAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouterApiKey" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouterApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouterProvider" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKeyEnv" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "timeoutMs" INTEGER NOT NULL DEFAULT 60000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouterProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouterModel" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "type" "RouterModelType" NOT NULL DEFAULT 'CHAT',
    "contextLength" INTEGER,
    "inputPricePerMTokMicros" BIGINT NOT NULL,
    "outputPricePerMTokMicros" BIGINT NOT NULL DEFAULT 0,
    "strategy" "RouterRoutingStrategy" NOT NULL DEFAULT 'PRIORITY',
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouterModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouterDeployment" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "upstreamModel" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "inputCostPerMTokMicros" BIGINT NOT NULL DEFAULT 0,
    "outputCostPerMTokMicros" BIGINT NOT NULL DEFAULT 0,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouterDeployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditTransaction" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "CreditTransactionType" NOT NULL,
    "amountMicros" BIGINT NOT NULL,
    "balanceAfterMicros" BIGINT NOT NULL,
    "requestId" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouterRequest" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "modelId" TEXT,
    "deploymentId" TEXT,
    "modelSlug" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "stream" BOOLEAN NOT NULL DEFAULT false,
    "status" "RouterRequestStatus" NOT NULL,
    "httpStatus" INTEGER NOT NULL,
    "errorMessage" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "usageEstimated" BOOLEAN NOT NULL DEFAULT false,
    "costMicros" BIGINT NOT NULL DEFAULT 0,
    "chargeMicros" BIGINT NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouterRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RouterAccount_email_key" ON "RouterAccount"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RouterApiKey_keyHash_key" ON "RouterApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "RouterApiKey_accountId_idx" ON "RouterApiKey"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "RouterProvider_slug_key" ON "RouterProvider"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "RouterModel_slug_key" ON "RouterModel"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "RouterDeployment_modelId_providerId_upstreamModel_key" ON "RouterDeployment"("modelId", "providerId", "upstreamModel");

-- CreateIndex
CREATE UNIQUE INDEX "CreditTransaction_requestId_key" ON "CreditTransaction"("requestId");

-- CreateIndex
CREATE INDEX "CreditTransaction_accountId_createdAt_idx" ON "CreditTransaction"("accountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreditTransaction_accountId_reference_key" ON "CreditTransaction"("accountId", "reference");

-- CreateIndex
CREATE INDEX "RouterRequest_accountId_createdAt_idx" ON "RouterRequest"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "RouterRequest_modelId_createdAt_idx" ON "RouterRequest"("modelId", "createdAt");

-- AddForeignKey
ALTER TABLE "RouterApiKey" ADD CONSTRAINT "RouterApiKey_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "RouterAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouterDeployment" ADD CONSTRAINT "RouterDeployment_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "RouterModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouterDeployment" ADD CONSTRAINT "RouterDeployment_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "RouterProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "RouterAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "RouterRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouterRequest" ADD CONSTRAINT "RouterRequest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "RouterAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouterRequest" ADD CONSTRAINT "RouterRequest_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "RouterApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouterRequest" ADD CONSTRAINT "RouterRequest_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "RouterModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouterRequest" ADD CONSTRAINT "RouterRequest_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "RouterDeployment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
