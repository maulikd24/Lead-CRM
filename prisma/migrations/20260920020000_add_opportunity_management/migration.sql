-- CreateEnum
CREATE TYPE "OpportunityProduct" AS ENUM ('MUTUAL_FUND', 'BROKING', 'PMS', 'AIF', 'BONDS', 'FIXED_INCOME', 'UNLISTED_PRE_IPO', 'OTHER');

-- CreateEnum
CREATE TYPE "OpportunityStage" AS ENUM ('IDENTIFIED', 'DISCUSSED', 'INTERESTED', 'RECOMMENDATION', 'DECISION_PENDING', 'COMMITTED', 'FUNDED', 'INVESTED', 'LOST_DEFERRED');

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "product" "OpportunityProduct" NOT NULL,
    "estimatedValue" DECIMAL(65,30) NOT NULL,
    "stage" "OpportunityStage" NOT NULL DEFAULT 'IDENTIFIED',
    "stageEnteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lostReason" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityStageHistory" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "fromStage" "OpportunityStage",
    "toStage" "OpportunityStage" NOT NULL,
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "OpportunityStageHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Opportunity_clientId_stage_idx" ON "Opportunity"("clientId", "stage");

-- CreateIndex
CREATE INDEX "Opportunity_ownerId_stage_idx" ON "Opportunity"("ownerId", "stage");

-- CreateIndex
CREATE INDEX "OpportunityStageHistory_opportunityId_changedAt_idx" ON "OpportunityStageHistory"("opportunityId", "changedAt");

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityStageHistory" ADD CONSTRAINT "OpportunityStageHistory_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityStageHistory" ADD CONSTRAINT "OpportunityStageHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
