-- CreateEnum
CREATE TYPE "CommissionRateType" AS ENUM ('PERCENT_OF_GROSS', 'PERCENT_OF_NET', 'FLAT_PER_TRANSACTION', 'SLAB');

-- CreateEnum
CREATE TYPE "RevenueType" AS ENUM ('BROKERAGE', 'TRAIL_COMMISSION', 'UPFRONT_COMMISSION', 'AMC_PAYOUT', 'ADVISORY_FEE', 'OTHER');

-- CreateEnum
CREATE TYPE "AccrualStatus" AS ENUM ('ACCRUED', 'ADJUSTED', 'REVERSED', 'INCLUDED_IN_PAYOUT');

-- CreateEnum
CREATE TYPE "PayoutRunStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'FINALIZED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('ESTIMATED', 'APPROVED', 'RECONCILED_EXTERNALLY');

-- CreateTable
CREATE TABLE "CommissionPlan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "appliesToPartnerType" "PartnerType",
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionRule" (
    "id" TEXT NOT NULL,
    "commissionPlanId" TEXT NOT NULL,
    "productCategory" "ProductCategory",
    "transactionType" "TransactionType",
    "rateType" "CommissionRateType" NOT NULL,
    "percentRate" DECIMAL(65,30),
    "flatRate" DECIMAL(65,30),
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionSlab" (
    "id" TEXT NOT NULL,
    "commissionRuleId" TEXT NOT NULL,
    "minAmount" DECIMAL(65,30) NOT NULL,
    "maxAmount" DECIMAL(65,30),
    "rate" DECIMAL(65,30) NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),

    CONSTRAINT "CommissionSlab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerCommissionAssignment" (
    "id" TEXT NOT NULL,
    "partnerProfileId" TEXT NOT NULL,
    "commissionPlanId" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "assignedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerCommissionAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevenueEvent" (
    "id" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "transactionId" TEXT,
    "tradingAccountId" TEXT,
    "clientId" TEXT,
    "revenueType" "RevenueType" NOT NULL,
    "grossRevenueAmount" DECIMAL(65,30) NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawPayload" JSONB NOT NULL,
    "reversesEventId" TEXT,

    CONSTRAINT "RevenueEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionAccrual" (
    "id" TEXT NOT NULL,
    "revenueEventId" TEXT NOT NULL,
    "partnerProfileId" TEXT NOT NULL,
    "commissionRuleId" TEXT,
    "accrualAmount" DECIMAL(65,30) NOT NULL,
    "accrualDate" TIMESTAMP(3) NOT NULL,
    "status" "AccrualStatus" NOT NULL DEFAULT 'ACCRUED',
    "computationVersion" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionAccrual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutRun" (
    "id" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "PayoutRunStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "payoutRunId" TEXT NOT NULL,
    "partnerProfileId" TEXT NOT NULL,
    "totalAccrualAmount" DECIMAL(65,30) NOT NULL,
    "adjustmentAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "netPayableAmount" DECIMAL(65,30) NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'ESTIMATED',
    "externalPayoutRef" TEXT,
    "reconciledAt" TIMESTAMP(3),

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutLine" (
    "id" TEXT NOT NULL,
    "payoutId" TEXT NOT NULL,
    "commissionAccrualId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "PayoutLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionAdjustment" (
    "id" TEXT NOT NULL,
    "partnerProfileId" TEXT NOT NULL,
    "payoutId" TEXT,
    "amount" DECIMAL(65,30) NOT NULL,
    "reason" TEXT NOT NULL,
    "approvalRequestId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommissionPlan_code_key" ON "CommissionPlan"("code");

-- CreateIndex
CREATE INDEX "CommissionRule_commissionPlanId_validFrom_validTo_idx" ON "CommissionRule"("commissionPlanId", "validFrom", "validTo");

-- CreateIndex
CREATE INDEX "CommissionSlab_commissionRuleId_validFrom_validTo_idx" ON "CommissionSlab"("commissionRuleId", "validFrom", "validTo");

-- CreateIndex
CREATE INDEX "PartnerCommissionAssignment_partnerProfileId_validFrom_vali_idx" ON "PartnerCommissionAssignment"("partnerProfileId", "validFrom", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "RevenueEvent_reversesEventId_key" ON "RevenueEvent"("reversesEventId");

-- CreateIndex
CREATE INDEX "RevenueEvent_tradingAccountId_eventDate_idx" ON "RevenueEvent"("tradingAccountId", "eventDate");

-- CreateIndex
CREATE INDEX "RevenueEvent_clientId_idx" ON "RevenueEvent"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "RevenueEvent_sourceSystem_externalRef_key" ON "RevenueEvent"("sourceSystem", "externalRef");

-- CreateIndex
CREATE INDEX "CommissionAccrual_partnerProfileId_accrualDate_idx" ON "CommissionAccrual"("partnerProfileId", "accrualDate");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionAccrual_revenueEventId_partnerProfileId_commissio_key" ON "CommissionAccrual"("revenueEventId", "partnerProfileId", "commissionRuleId");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutRun_periodStart_periodEnd_key" ON "PayoutRun"("periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_payoutRunId_partnerProfileId_key" ON "Payout"("payoutRunId", "partnerProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutLine_payoutId_commissionAccrualId_key" ON "PayoutLine"("payoutId", "commissionAccrualId");

-- AddForeignKey
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_commissionPlanId_fkey" FOREIGN KEY ("commissionPlanId") REFERENCES "CommissionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionSlab" ADD CONSTRAINT "CommissionSlab_commissionRuleId_fkey" FOREIGN KEY ("commissionRuleId") REFERENCES "CommissionRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerCommissionAssignment" ADD CONSTRAINT "PartnerCommissionAssignment_partnerProfileId_fkey" FOREIGN KEY ("partnerProfileId") REFERENCES "PartnerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerCommissionAssignment" ADD CONSTRAINT "PartnerCommissionAssignment_commissionPlanId_fkey" FOREIGN KEY ("commissionPlanId") REFERENCES "CommissionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerCommissionAssignment" ADD CONSTRAINT "PartnerCommissionAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueEvent" ADD CONSTRAINT "RevenueEvent_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueEvent" ADD CONSTRAINT "RevenueEvent_tradingAccountId_fkey" FOREIGN KEY ("tradingAccountId") REFERENCES "TradingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueEvent" ADD CONSTRAINT "RevenueEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueEvent" ADD CONSTRAINT "RevenueEvent_reversesEventId_fkey" FOREIGN KEY ("reversesEventId") REFERENCES "RevenueEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionAccrual" ADD CONSTRAINT "CommissionAccrual_revenueEventId_fkey" FOREIGN KEY ("revenueEventId") REFERENCES "RevenueEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionAccrual" ADD CONSTRAINT "CommissionAccrual_partnerProfileId_fkey" FOREIGN KEY ("partnerProfileId") REFERENCES "PartnerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionAccrual" ADD CONSTRAINT "CommissionAccrual_commissionRuleId_fkey" FOREIGN KEY ("commissionRuleId") REFERENCES "CommissionRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutRun" ADD CONSTRAINT "PayoutRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutRun" ADD CONSTRAINT "PayoutRun_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_payoutRunId_fkey" FOREIGN KEY ("payoutRunId") REFERENCES "PayoutRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_partnerProfileId_fkey" FOREIGN KEY ("partnerProfileId") REFERENCES "PartnerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutLine" ADD CONSTRAINT "PayoutLine_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutLine" ADD CONSTRAINT "PayoutLine_commissionAccrualId_fkey" FOREIGN KEY ("commissionAccrualId") REFERENCES "CommissionAccrual"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionAdjustment" ADD CONSTRAINT "CommissionAdjustment_partnerProfileId_fkey" FOREIGN KEY ("partnerProfileId") REFERENCES "PartnerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionAdjustment" ADD CONSTRAINT "CommissionAdjustment_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionAdjustment" ADD CONSTRAINT "CommissionAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

