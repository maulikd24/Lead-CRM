-- CreateEnum
CREATE TYPE "PartnerTaxKind" AS ENUM ('TDS', 'GST');

-- CreateEnum
CREATE TYPE "PartnerPanStatus" AS ENUM ('ANY', 'PRESENT', 'ABSENT');

-- CreateEnum
CREATE TYPE "PartnerGstRegistration" AS ENUM ('ANY', 'REGISTERED', 'UNREGISTERED');

-- CreateEnum
CREATE TYPE "PartnerGstMode" AS ENUM ('REVERSE_CHARGE', 'SELF_INVOICE', 'PARTNER_INVOICED');

-- AlterTable
ALTER TABLE "CommissionAccrual" ADD COLUMN     "overrideKey" TEXT,
ADD COLUMN     "overrideRuleId" TEXT,
ADD COLUMN     "sourceAccrualId" TEXT;

-- CreateTable
CREATE TABLE "PartnerTaxRule" (
    "id" TEXT NOT NULL,
    "kind" "PartnerTaxKind" NOT NULL,
    "label" TEXT NOT NULL,
    "ratePercent" DECIMAL(8,4) NOT NULL,
    "thresholdAmount" DECIMAL(18,2),
    "partnerTypes" "PartnerType"[],
    "panStatus" "PartnerPanStatus" NOT NULL DEFAULT 'ANY',
    "gstRegistration" "PartnerGstRegistration" NOT NULL DEFAULT 'ANY',
    "gstMode" "PartnerGstMode",
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "approvalRequestId" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerTaxRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerOverrideRule" (
    "id" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "ratePercent" DECIMAL(8,4) NOT NULL,
    "capPerAccrual" DECIMAL(18,2),
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "approvalRequestId" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerOverrideRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerWorkspaceSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerWorkspaceSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "PartnerReferralTouch" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "partnerProfileId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "touchedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerReferralTouch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerAttributionEvent" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "partnerProfileId" TEXT,
    "code" TEXT,
    "decision" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerAttributionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerStatementQuery" (
    "id" TEXT NOT NULL,
    "partnerProfileId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "lineRef" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "taskId" TEXT,
    "raisedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerStatementQuery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnerTaxRule_kind_effectiveFrom_idx" ON "PartnerTaxRule"("kind", "effectiveFrom");

-- CreateIndex
CREATE INDEX "PartnerOverrideRule_level_effectiveFrom_idx" ON "PartnerOverrideRule"("level", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerReferralTouch_clientId_key" ON "PartnerReferralTouch"("clientId");

-- CreateIndex
CREATE INDEX "PartnerReferralTouch_partnerProfileId_expiresAt_idx" ON "PartnerReferralTouch"("partnerProfileId", "expiresAt");

-- CreateIndex
CREATE INDEX "PartnerReferralTouch_expiresAt_idx" ON "PartnerReferralTouch"("expiresAt");

-- CreateIndex
CREATE INDEX "PartnerAttributionEvent_clientId_idx" ON "PartnerAttributionEvent"("clientId");

-- CreateIndex
CREATE INDEX "PartnerAttributionEvent_createdAt_idx" ON "PartnerAttributionEvent"("createdAt");

-- CreateIndex
CREATE INDEX "PartnerStatementQuery_partnerProfileId_createdAt_idx" ON "PartnerStatementQuery"("partnerProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "PartnerStatementQuery_raisedById_lineRef_idx" ON "PartnerStatementQuery"("raisedById", "lineRef");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionAccrual_overrideKey_key" ON "CommissionAccrual"("overrideKey");

-- CreateIndex
CREATE INDEX "CommissionAccrual_sourceAccrualId_idx" ON "CommissionAccrual"("sourceAccrualId");

-- AddForeignKey
ALTER TABLE "PartnerReferralTouch" ADD CONSTRAINT "PartnerReferralTouch_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerReferralTouch" ADD CONSTRAINT "PartnerReferralTouch_partnerProfileId_fkey" FOREIGN KEY ("partnerProfileId") REFERENCES "PartnerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
