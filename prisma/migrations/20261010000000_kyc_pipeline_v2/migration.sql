-- KYC pipeline v2: per-step, per-holder verification tracking (see KycStep in schema.prisma).

-- CreateEnum
CREATE TYPE "KycStepType" AS ENUM ('PAN_VERIFICATION', 'ADDRESS_VERIFICATION', 'BANK_VERIFICATION', 'RISK_PROFILE', 'IPV', 'ESIGN', 'KRA', 'CKYC');

-- CreateEnum
CREATE TYPE "KycStepStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'VERIFIED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "KycStep" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "holderId" TEXT,
    "holderKey" TEXT NOT NULL,
    "type" "KycStepType" NOT NULL,
    "status" "KycStepStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "provider" TEXT,
    "providerRef" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "result" JSONB,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reminderLevel" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KycStep_status_statusChangedAt_idx" ON "KycStep"("status", "statusChangedAt");

-- CreateIndex
CREATE INDEX "KycStep_holderId_idx" ON "KycStep"("holderId");

-- CreateIndex
CREATE UNIQUE INDEX "KycStep_clientId_holderKey_type_key" ON "KycStep"("clientId", "holderKey", "type");

-- AddForeignKey
ALTER TABLE "KycStep" ADD CONSTRAINT "KycStep_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycStep" ADD CONSTRAINT "KycStep_holderId_fkey" FOREIGN KEY ("holderId") REFERENCES "AccountHolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
